# Climate impact: methodology

## What is measured
Green Lane estimates **transport-activity emissions per shipment** using the distance-based method that ISO 14083 and the GLEC Framework describe for cases without primary fuel data:

    emissions (kg CO2e) = mass (t) × distance (km) × emission intensity (kg CO2e / t·km)

On-chain: `co2eGrams = weightKg × km × factorMgPerTkm / 1e6`, which is integer math with no floating point.

## Emission factors (defaults in the contract)
Source: UK DESNZ/DEFRA, *Greenhouse gas reporting: conversion factors 2025*, "Freighting goods" sheet (kg CO2e per tonne.km).
https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025

| Mode | DEFRA 2025 line | kg CO2e/tkm | On-chain (mg/tkm) |
|---|---|---|---|
| Road | HGV (all diesel), All HGVs, Average laden | 0.10163 | 101,630 |
| Rail | Rail, Freight train | 0.02779 | 27,790 |
| Sea | Cargo ship, Container ship, Average | 0.01612 | 16,120 |
| Air | Freight flights, Long-haul to/from UK, with RF | 0.89939 | 899,390 |

The values were transcribed from the 2025 freighting-goods table and should be re-checked against the official spreadsheet before production use. The arbiter can update any factor with `setFactor`, which emits `FactorSet`, so every change is public.

Why DEFRA defaults: they are free, published every year, and widely used for Scope 3 category 4/9 reporting. The GLEC Framework v3 (Smart Freight Centre, Module 2) offers region-specific default intensities, e.g. road values that depend on payload and empty running. The roadmap moves to GLEC regional defaults and then to primary data from carriers. Reference: https://smart-freight-centre-media.s3.amazonaws.com/documents/GLEC_FRAMEWORK_v3_UPDATED_04_12_24.pdf

## Limits (stated honestly)
- Default factors are averages. A real truck's emissions depend on load factor, empty running, fuel and vehicle class. This is an estimate, not a measurement.
- Distance and mode come from the declaration or from the attestor. The bonus is only as trustworthy as the evidence the attestor checks.
- There is no hub/warehouse emissions and no multi-leg split yet: one mode per shipment.
- Results in this repo come from testnet demo shipments only. I have no real-world reduction figures yet and don't claim any.

## How it can reduce emissions
The mechanism is economic, not an offset. Shippers can attach a small, enforceable premium to a lower-emission mode (e.g. rail instead of road). Carriers that deliver what they declared build a public intensity and match record that other shippers can read. On the default factors, moving 10 t × 1,000 km from road to rail cuts the estimate from 1,016 kg to 278 kg CO2e (−73%). That is arithmetic on the factors, not a measured result.

## Adoption path
1. Pilot with Turkish SME shippers on Istanbul–Ankara/İzmir lanes (road vs. intermodal rail).
2. Replace declared distance with telematics/GPS-trace attestation in the settlement agent.
3. Export per-shipment records as ISO 14083-style reports for shippers' Scope 3 inventories.
