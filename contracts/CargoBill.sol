// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CargoBill is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PROTOCOL_FEE_BPS = 50;
    uint256 public constant AUTO_RELEASE_DELAY = 48 hours;

    address public immutable usdc;
    address public immutable feeRecipient;
    address public arbiter;
    uint256 public shipmentCount;

    enum ShipmentStatus {
        Created,
        PickedUp,
        Delivered,
        Released,
        Disputed,
        Cancelled,
        Resolved
    }

    struct Shipment {
        uint256 id;
        address shipper;
        address carrier;
        uint256 amount;
        uint256 deadline;
        string metadataURI;
        ShipmentStatus status;
        uint256 pickedUpAt;
        uint256 deliveredAt;
        string disputeReason;
    }

    struct Reputation {
        uint256 completed;
        uint256 disputed;
        uint256 late;
    }

    mapping(uint256 => Shipment) public shipments;
    mapping(address => Reputation) public reputation;

    event ShipmentCreated(
        uint256 indexed id,
        address indexed shipper,
        address indexed carrier,
        uint256 amount,
        uint256 deadline,
        string metadataURI
    );
    event PickedUp(uint256 indexed id, uint256 timestamp);
    event MarkedDelivered(uint256 indexed id, uint256 timestamp);
    event DeliveryConfirmed(uint256 indexed id);
    event FundsReleased(uint256 indexed id, address indexed carrier, uint256 net, uint256 fee);
    event AutoReleased(uint256 indexed id, address indexed caller);
    event DisputeOpened(uint256 indexed id, address indexed opener, string reason);
    event DisputeResolved(uint256 indexed id, uint256 carrierBps, uint256 carrierAmount, uint256 shipperAmount);
    event ShipmentCancelled(uint256 indexed id);
    event ArbiterChanged(address indexed oldArbiter, address indexed newArbiter);

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "CargoBill: not arbiter");
        _;
    }

    constructor(address _usdc, address _feeRecipient, address _arbiter) {
        require(_usdc != address(0), "CargoBill: zero usdc");
        require(_feeRecipient != address(0), "CargoBill: zero fee recipient");
        require(_arbiter != address(0), "CargoBill: zero arbiter");

        usdc = _usdc;
        feeRecipient = _feeRecipient;
        arbiter = _arbiter;
    }

    function createShipment(
        address carrier,
        uint256 amountUSDC,
        uint256 deadline,
        string calldata metadataURI
    ) external nonReentrant returns (uint256 id) {
        require(carrier != address(0), "CargoBill: zero carrier");
        require(amountUSDC > 0, "CargoBill: zero amount");
        require(deadline > block.timestamp, "CargoBill: bad deadline");

        id = ++shipmentCount;

        shipments[id] = Shipment({
            id: id,
            shipper: msg.sender,
            carrier: carrier,
            amount: amountUSDC,
            deadline: deadline,
            metadataURI: metadataURI,
            status: ShipmentStatus.Created,
            pickedUpAt: 0,
            deliveredAt: 0,
            disputeReason: ""
        });

        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amountUSDC);

        emit ShipmentCreated(id, msg.sender, carrier, amountUSDC, deadline, metadataURI);
    }

    function markPickedUp(uint256 id) external {
        Shipment storage s = shipments[id];

        require(msg.sender == s.carrier, "CargoBill: not carrier");
        require(s.status == ShipmentStatus.Created, "CargoBill: bad status");
        require(block.timestamp < s.deadline, "CargoBill: deadline passed");

        s.status = ShipmentStatus.PickedUp;
        s.pickedUpAt = block.timestamp;

        emit PickedUp(id, block.timestamp);
    }

    function markDelivered(uint256 id) external {
        Shipment storage s = shipments[id];

        require(msg.sender == s.carrier, "CargoBill: not carrier");
        require(s.status == ShipmentStatus.PickedUp, "CargoBill: bad status");

        s.status = ShipmentStatus.Delivered;
        s.deliveredAt = block.timestamp;

        emit MarkedDelivered(id, block.timestamp);
    }

    function confirmDelivery(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(msg.sender == s.shipper, "CargoBill: not shipper");
        require(s.status == ShipmentStatus.Delivered, "CargoBill: bad status");

        uint256 fee = (s.amount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 net = s.amount - fee;

        s.status = ShipmentStatus.Released;
        reputation[s.carrier].completed++;
        if (s.deliveredAt > s.deadline) {
            reputation[s.carrier].late++;
        }

        IERC20(usdc).safeTransfer(feeRecipient, fee);
        IERC20(usdc).safeTransfer(s.carrier, net);

        emit DeliveryConfirmed(id);
        emit FundsReleased(id, s.carrier, net, fee);
    }

    function autoRelease(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(s.status == ShipmentStatus.Delivered, "CargoBill: bad status");
        require(block.timestamp >= s.deliveredAt + AUTO_RELEASE_DELAY, "CargoBill: delay not met");

        uint256 fee = (s.amount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 net = s.amount - fee;

        s.status = ShipmentStatus.Released;
        reputation[s.carrier].completed++;
        if (s.deliveredAt > s.deadline) {
            reputation[s.carrier].late++;
        }

        IERC20(usdc).safeTransfer(feeRecipient, fee);
        IERC20(usdc).safeTransfer(s.carrier, net);

        emit AutoReleased(id, msg.sender);
        emit FundsReleased(id, s.carrier, net, fee);
    }

    function openDispute(uint256 id, string calldata reason) external {
        Shipment storage s = shipments[id];

        require(msg.sender == s.shipper || msg.sender == s.carrier, "CargoBill: not participant");
        require(
            s.status == ShipmentStatus.PickedUp || s.status == ShipmentStatus.Delivered,
            "CargoBill: bad status"
        );

        s.status = ShipmentStatus.Disputed;
        s.disputeReason = reason;

        emit DisputeOpened(id, msg.sender, reason);
    }

    function resolveDispute(uint256 id, uint256 carrierBps) external nonReentrant onlyArbiter {
        Shipment storage s = shipments[id];

        require(s.status == ShipmentStatus.Disputed, "CargoBill: bad status");
        require(carrierBps <= 10_000, "CargoBill: invalid bps");

        uint256 carrierAmount = (s.amount * carrierBps) / 10_000;
        uint256 shipperAmount = s.amount - carrierAmount;

        s.status = ShipmentStatus.Resolved;
        reputation[s.carrier].disputed++;

        if (carrierAmount > 0) {
            IERC20(usdc).safeTransfer(s.carrier, carrierAmount);
        }
        if (shipperAmount > 0) {
            IERC20(usdc).safeTransfer(s.shipper, shipperAmount);
        }

        emit DisputeResolved(id, carrierBps, carrierAmount, shipperAmount);
    }

    function cancel(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(msg.sender == s.shipper, "CargoBill: not shipper");
        require(s.status == ShipmentStatus.Created, "CargoBill: bad status");

        s.status = ShipmentStatus.Cancelled;
        if (block.timestamp >= s.deadline) {
            reputation[s.carrier].late++;
        }

        IERC20(usdc).safeTransfer(s.shipper, s.amount);

        emit ShipmentCancelled(id);
    }

    function changeArbiter(address newArbiter) external onlyArbiter {
        require(newArbiter != address(0), "CargoBill: zero arbiter");

        address oldArbiter = arbiter;
        arbiter = newArbiter;

        emit ArbiterChanged(oldArbiter, newArbiter);
    }
}
