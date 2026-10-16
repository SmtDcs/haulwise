// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CargoBill} from "./CargoBill.sol";

/// @title HaulwiseGreenLane
/// @notice CargoBill escrow plus an emissions layer:
///  - every released shipment gets a CO2e estimate written on-chain (tonne-km x mode factor),
///  - carriers accumulate an emissions-intensity record and a green score,
///  - a shipper can lock an optional USDC green bonus that is paid to the carrier only when the
///    attested route matches the declared mode and stays within the declared distance (+10%).
/// Factors are stored in mg CO2e per tonne-km and are set by the arbiter (logged on-chain).
/// Defaults: UK DESNZ/DEFRA 2025 "Freighting goods" conversion factors (see docs/CLIMATE_IMPACT.md).
contract HaulwiseGreenLane is CargoBill {
    using SafeERC20 for IERC20;

    enum Mode {
        Road,
        Rail,
        Sea,
        Air
    }

    struct Green {
        Mode declaredMode;
        uint32 declaredDistanceKm;
        uint32 weightKg;
        bool attested;
        Mode actualMode;
        uint32 actualDistanceKm;
        bool routeMatched;
        bool settled;
        uint256 bonus;
        uint256 co2eGrams;
    }

    struct GreenRep {
        uint256 kgKm; // sum of weightKg * km over released shipments
        uint256 co2eGrams; // sum of on-chain CO2e estimates
        uint256 attested; // released shipments with an attested route
        uint256 matched; // attested shipments whose route matched the declaration
        uint256 bonusEarned; // USDC (6 dec) green bonuses received
    }

    uint256 public constant DISTANCE_TOLERANCE_BPS = 11_000; // actual may be up to 110% of declared
    uint32 public constant MAX_DISTANCE_KM = 40_000;
    uint32 public constant MAX_WEIGHT_KG = 100_000_000; // 100k tonnes

    address public attestor;
    mapping(Mode => uint256) public factorMgPerTkm;
    mapping(uint256 => Green) public green;
    mapping(address => GreenRep) public greenRep;

    event GreenShipmentCreated(
        uint256 indexed id, Mode declaredMode, uint32 distanceKm, uint32 weightKg, uint256 bonus
    );
    event RouteAttested(uint256 indexed id, Mode actualMode, uint32 actualDistanceKm, address attestor);
    event EmissionsRecorded(
        uint256 indexed id, address indexed carrier, Mode mode, uint256 tonneKmX1000, uint256 co2eGrams, bool attested
    );
    event GreenBonusPaid(uint256 indexed id, address indexed carrier, uint256 amount);
    event GreenBonusReturned(uint256 indexed id, address indexed shipper, uint256 amount);
    event FactorSet(Mode indexed mode, uint256 mgPerTkm);
    event AttestorSet(address indexed attestor);

    constructor(address _usdc, address _feeRecipient, address _arbiter, address _attestor)
        CargoBill(_usdc, _feeRecipient, _arbiter)
    {
        attestor = _attestor;
        // DESNZ/DEFRA 2025 Freighting goods, kg CO2e per tonne.km x 1e6 (WTW not included; see docs)
        factorMgPerTkm[Mode.Road] = 101_630; // HGV (all diesel), all HGVs, average laden: 0.10163
        factorMgPerTkm[Mode.Rail] = 27_790; // Rail, freight train: 0.02779
        factorMgPerTkm[Mode.Sea] = 16_120; // Cargo ship, container ship, average: 0.01612
        factorMgPerTkm[Mode.Air] = 899_390; // Freight flights, long-haul, with RF: 0.89939
        emit AttestorSet(_attestor);
    }

    // ── admin ──────────────────────────────────────────────────────────────

    function setFactor(Mode mode, uint256 mgPerTkm) external {
        require(msg.sender == arbiter, "GreenLane: not arbiter");
        require(mgPerTkm > 0 && mgPerTkm <= 10_000_000, "GreenLane: bad factor");
        factorMgPerTkm[mode] = mgPerTkm;
        emit FactorSet(mode, mgPerTkm);
    }

    function setAttestor(address a) external {
        require(msg.sender == arbiter, "GreenLane: not arbiter");
        attestor = a;
        emit AttestorSet(a);
    }

    // ── shipper ────────────────────────────────────────────────────────────

    /// @notice Create an escrowed shipment with emissions data and an optional green bonus.
    /// Shipper must approve amountUSDC + bonusUSDC.
    function createGreenShipment(
        address carrier,
        uint256 amountUSDC,
        uint256 pickupDeadline,
        uint256 deliveryDeadline,
        string calldata metadataURI,
        Mode declaredMode,
        uint32 distanceKm,
        uint32 weightKg,
        uint256 bonusUSDC
    ) external returns (uint256 id) {
        require(distanceKm > 0 && distanceKm <= MAX_DISTANCE_KM, "GreenLane: bad distance");
        require(weightKg > 0 && weightKg <= MAX_WEIGHT_KG, "GreenLane: bad weight");

        id = createShipment(carrier, amountUSDC, pickupDeadline, deliveryDeadline, metadataURI);

        Green storage g = green[id];
        g.declaredMode = declaredMode;
        g.declaredDistanceKm = distanceKm;
        g.weightKg = weightKg;
        g.bonus = bonusUSDC;

        if (bonusUSDC > 0) {
            IERC20(usdc).safeTransferFrom(msg.sender, address(this), bonusUSDC);
        }

        emit GreenShipmentCreated(id, declaredMode, distanceKm, weightKg, bonusUSDC);
    }

    // ── attestor (settlement agent) ────────────────────────────────────────

    /// @notice Record the route actually driven/sailed/flown, from delivery evidence.
    /// Allowed while the shipment is in transit or delivered (before release). Can be corrected.
    function attestRoute(uint256 id, Mode actualMode, uint32 actualDistanceKm) external {
        require(msg.sender == attestor || msg.sender == arbiter, "GreenLane: not attestor");
        Green storage g = green[id];
        require(g.weightKg > 0, "GreenLane: not green shipment");
        ShipmentStatus st = shipments[id].status;
        require(st == ShipmentStatus.PickedUp || st == ShipmentStatus.Delivered, "GreenLane: bad status");
        require(actualDistanceKm > 0 && actualDistanceKm <= MAX_DISTANCE_KM, "GreenLane: bad distance");

        g.attested = true;
        g.actualMode = actualMode;
        g.actualDistanceKm = actualDistanceKm;

        emit RouteAttested(id, actualMode, actualDistanceKm, msg.sender);
    }

    // ── settlement hook ────────────────────────────────────────────────────

    function _afterSettle(uint256 id, bool released) internal override {
        Green storage g = green[id];
        if (g.weightKg == 0 || g.settled) return; // plain CargoBill shipment
        g.settled = true;

        Shipment storage s = shipments[id];
        uint256 bonus = g.bonus;

        if (!released) {
            if (bonus > 0) {
                IERC20(usdc).safeTransfer(s.shipper, bonus);
                emit GreenBonusReturned(id, s.shipper, bonus);
            }
            return;
        }

        Mode mode = g.attested ? g.actualMode : g.declaredMode;
        uint256 km = g.attested ? g.actualDistanceKm : g.declaredDistanceKm;
        uint256 kgKm = uint256(g.weightKg) * km;
        uint256 co2e = (kgKm * factorMgPerTkm[mode]) / 1e6; // kg*km/1000 = tkm; mg/1000 = g
        g.co2eGrams = co2e;

        bool matched = g.attested && g.actualMode == g.declaredMode
            && uint256(g.actualDistanceKm) * 10_000 <= uint256(g.declaredDistanceKm) * DISTANCE_TOLERANCE_BPS;
        g.routeMatched = matched;

        GreenRep storage r = greenRep[s.carrier];
        r.kgKm += kgKm;
        r.co2eGrams += co2e;
        if (g.attested) r.attested++;
        if (matched) r.matched++;

        emit EmissionsRecorded(id, s.carrier, mode, kgKm, co2e, g.attested);

        if (bonus > 0) {
            if (matched) {
                r.bonusEarned += bonus;
                IERC20(usdc).safeTransfer(s.carrier, bonus);
                emit GreenBonusPaid(id, s.carrier, bonus);
            } else {
                IERC20(usdc).safeTransfer(s.shipper, bonus);
                emit GreenBonusReturned(id, s.shipper, bonus);
            }
        }
    }

    // ── views ──────────────────────────────────────────────────────────────

    /// @notice Carrier emissions intensity in mg CO2e per tonne-km (0 if no history).
    function intensityMgPerTkm(address carrier) public view returns (uint256) {
        GreenRep storage r = greenRep[carrier];
        if (r.kgKm == 0) return 0;
        return (r.co2eGrams * 1e6) / r.kgKm;
    }

    /// @notice 0-100. Half from intensity vs. the all-road baseline, half from attested route matches.
    /// A carrier with no released green shipments scores 0.
    function greenScore(address carrier) external view returns (uint256) {
        GreenRep storage r = greenRep[carrier];
        if (r.kgKm == 0) return 0;
        uint256 road = factorMgPerTkm[Mode.Road];
        uint256 i = intensityMgPerTkm(carrier);
        uint256 intensityPart = i >= road ? 0 : ((road - i) * 50) / road;
        uint256 released = reputation[carrier].completed;
        uint256 matchPart = released == 0 ? 0 : (r.matched * 50) / released;
        if (matchPart > 50) matchPart = 50;
        return intensityPart + matchPart;
    }

    function estimateCo2eGrams(Mode mode, uint32 distanceKm, uint32 weightKg) external view returns (uint256) {
        return (uint256(weightKg) * distanceKm * factorMgPerTkm[mode]) / 1e6;
    }
}
