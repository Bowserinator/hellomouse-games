/** Declarative catalog of machines, one-time projects and activatable abilities. */
import type { Content } from './types.js';

export const CONTENT: Content = {
    contentVersion: 1,
    machines: [
        {
            id: 'bench', name: 'Garage Workbench', icon: 'handyman', category: 'bench',
            baseCost: 30, growth: 1.12, basePps: 2, baseRps: 0, unlock: 0
        },
        {
            id: 'line', name: 'Third-world Sweatshop', icon: 'linear_scale', category: 'line',
            baseCost: 300, growth: 1.14, basePps: 18, baseRps: 0, unlock: 500
        },
        {
            id: 'contract', name: 'Contract Factory', icon: 'business', category: 'contract',
            baseCost: 5_000, growth: 1.15, basePps: 220, baseRps: 0, unlock: 50_000
        },
        {
            id: 'automated', name: 'Automated Plant', icon: 'precision_manufacturing', category: 'automated',
            baseCost: 70_000, growth: 1.16, basePps: 3_500, baseRps: 0, unlock: 750_000
        },
        {
            id: 'mega', name: 'Robotics Megaplant', icon: 'smart_toy', category: 'mega',
            baseCost: 1_000_000, growth: 1.18, basePps: 60_000, baseRps: 0, unlock: 10_000_000
        },
        {
            id: 'nano', name: 'Nano-Assembly Complex', icon: 'blur_on', category: 'nano',
            baseCost: 20_000_000, growth: 1.20, basePps: 1_200_000, baseRps: 0, unlock: 40_000_000
        },
        {
            id: 'lab', name: 'Research Lab', icon: 'science', category: 'research',
            baseCost: 35_000, growth: 1.6, basePps: 0, baseRps: 1, unlock: 100_000
        }
    ],
    upgrades: [
        {
            id: 'eco_ergonomic_tools', name: 'Ergonomic Workstations', lane: 'economy', tier: 1,
            description: 'Every click assembles 2 more phones.', stat: '+2 per click', icon: 'touch_app',
            purchase: { cash: 100 },
            effects: [{ type: 'add_manual_click', target: 'self', count: 2 }]
        },
        {
            id: 'eco_assembly_jigs', name: 'Precision Assembly Jigs', lane: 'economy', tier: 1,
            description: '+30% Hand Bench and Small Line production.', stat: '+30% bench, line', icon: 'straighten',
            purchase: { cash: 250 },
            effects: [
                { type: 'multiply_machine_category', target: 'self', factor: 1.3, machineCategory: 'bench', stackGroup: 'bench_bonus' },
                { type: 'multiply_machine_category', target: 'self', factor: 1.3, machineCategory: 'line', stackGroup: 'line_bonus' }
            ]
        },
        {
            id: 'eco_bulk_parts', name: 'Bulk Component Purchasing', lane: 'economy', tier: 1,
            description: '+20% cash earned for every phone sold.', stat: '+20% sale price', icon: 'shopping_cart',
            purchase: { cash: 400 },
            effects: [{ type: 'multiply_sale_price', target: 'self', factor: 1.2 }]
        },
        {
            id: 'eco_outsourcing', name: 'Overseas Contract Manufacturing', lane: 'economy', tier: 2,
            description: '+60% Contract Factory production.', stat: '+60% contract', icon: 'public',
            purchase: { cash: 3_000 },
            effects: [{ type: 'multiply_machine_category', target: 'self', factor: 1.6, machineCategory: 'contract', stackGroup: 'contract_bonus' }]
        },
        {
            id: 'eco_qc', name: 'Automated Quality Control', lane: 'economy', tier: 2,
            description: '+25% production from all machines.', stat: '+25% auto PPS', icon: 'verified',
            purchase: { cash: 6_000 },
            effects: [{ type: 'multiply_auto_production', target: 'self', factor: 1.25 }]
        },
        {
            id: 'eco_smt', name: 'Surface-Mount Robotics', lane: 'economy', tier: 2,
            description: '+40% Small Line and Contract Factory production.', stat: '+40% line, contract', icon: 'memory',
            purchase: { cash: 12_000 },
            effects: [
                { type: 'multiply_machine_category', target: 'self', factor: 1.4, machineCategory: 'line', stackGroup: 'line_bonus' },
                { type: 'multiply_machine_category', target: 'self', factor: 1.4, machineCategory: 'contract', stackGroup: 'contract_bonus' }
            ]
        },
        {
            id: 'eco_3d_print', name: 'Industrial 3D Printing', lane: 'economy', tier: 3,
            description: '+35% all phone production, including clicks.', stat: '+35% production', icon: 'print',
            purchase: { cash: 60_000 },
            effects: [{ type: 'multiply_production', target: 'self', factor: 1.35 }]
        },
        {
            id: 'eco_supply_ai', name: 'Supply Chain AI', lane: 'economy', tier: 3,
            description: '+45% production from all machines.', stat: '+45% auto PPS', icon: 'psychology',
            purchase: { cash: 120_000, research: 60 },
            effects: [{ type: 'multiply_auto_production', target: 'self', factor: 1.45 }]
        },
        {
            id: 'eco_silicon', name: 'In-House Chip Fabrication', lane: 'economy', tier: 3,
            description: '+50% cash per phone sold and +10% all production.', stat: '+50% sale price', icon: 'developer_board',
            purchase: { cash: 180_000, research: 100 },
            effects: [
                { type: 'multiply_sale_price', target: 'self', factor: 1.5 },
                { type: 'multiply_production', target: 'self', factor: 1.1 }
            ]
        },
        {
            id: 'eco_lights_out', name: 'Lights-Out Factories', lane: 'economy', tier: 4,
            description: 'Machine production is multiplied by 1.6.', stat: '×1.6 auto PPS', icon: 'power_settings_new',
            purchase: { cash: 600_000, research: 200 },
            effects: [{ type: 'multiply_auto_production', target: 'self', factor: 1.6 }]
        },
        {
            id: 'eco_modular', name: 'Modular Phone Architecture', lane: 'economy', tier: 4,
            description: 'Machine production is multiplied by 1.5 and sabotage is mitigated by 10%.', stat: '×1.5 auto PPS', icon: 'view_module',
            purchase: { cash: 1_000_000, research: 350 },
            effects: [
                { type: 'multiply_auto_production', target: 'self', factor: 1.5 },
                { type: 'add_mitigation', target: 'self', fraction: 0.10 }
            ]
        },
        {
            id: 'eco_digital_twin', name: 'Digital Twin Optimization', lane: 'economy', tier: 4,
            description: 'Machine production is multiplied by 1.8.', stat: '×1.8 auto PPS', icon: 'device_hub',
            purchase: { cash: 1_400_000, research: 500 },
            effects: [{ type: 'multiply_auto_production', target: 'self', factor: 1.8 }]
        },
        {
            id: 'eco_nanofab', name: 'Molecular Phone Printing', lane: 'economy', tier: 5,
            description: 'All phone production is multiplied by 2.3.', stat: '×2.3 production', icon: 'grain',
            purchase: { cash: 6_000_000, research: 1_200 },
            effects: [{ type: 'multiply_production', target: 'self', factor: 2.3 }]
        },
        {
            id: 'eco_swarm', name: 'Self-Replicating Microfactories', lane: 'economy', tier: 5,
            description: 'Machine production is multiplied by 2.', stat: '×2 auto PPS', icon: 'all_inclusive',
            purchase: { cash: 10_000_000, research: 1_800 },
            effects: [{ type: 'multiply_auto_production', target: 'self', factor: 2 }]
        },
        {
            id: 'eco_quantum', name: 'Quantum Supply Orchestration', lane: 'economy', tier: 5,
            description: 'All phone production is multiplied by 2 and labs make 50% more research.', stat: '×2 production', icon: 'rocket_launch',
            purchase: { cash: 16_000_000, research: 2_500 },
            effects: [
                { type: 'multiply_production', target: 'self', factor: 2 },
                { type: 'multiply_research_rate', target: 'self', factor: 1.5 }
            ]
        },

        {
            id: 'def_cameras', name: 'Factory CCTV', lane: 'defense', tier: 1,
            description: 'Mitigates 8% of incoming sabotage.', stat: '+8% mitigation', icon: 'videocam',
            purchase: { cash: 300 },
            effects: [{ type: 'add_mitigation', target: 'self', fraction: 0.08 }]
        },
        {
            id: 'def_backup', name: 'Backup Power Units', lane: 'defense', tier: 1,
            description: 'Power-related attacks last 30% shorter.', stat: '-30% power time', icon: 'battery_charging_full',
            purchase: { cash: 500 },
            effects: [{ type: 'reduce_attack_duration', target: 'self', fraction: 0.30, category: 'power' }]
        },
        {
            id: 'def_patch', name: 'Emergency Firmware Patch', lane: 'defense', tier: 1,
            description: 'Unlocks Emergency Patch, which removes one active attack.', stat: 'Removes 1 attack', icon: 'system_update',
            purchase: { cash: 700 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_emergency_patch' }]
        },
        {
            id: 'def_safety_stock', name: 'Component Safety Stock', lane: 'defense', tier: 2,
            description: 'Supply-related attacks are 25% weaker.', stat: '-25% supply hits', icon: 'inventory_2',
            purchase: { cash: 4_000 },
            effects: [{ type: 'reduce_attack_severity', target: 'self', fraction: 0.25, category: 'supply' }]
        },
        {
            id: 'def_security', name: 'Factory Security Team', lane: 'defense', tier: 2,
            description: 'Mitigates 10% of incoming sabotage.', stat: '+10% mitigation', icon: 'security',
            purchase: { cash: 7_000 },
            effects: [{ type: 'add_mitigation', target: 'self', fraction: 0.10 }]
        },
        {
            id: 'def_firewall', name: 'Production Network Firewall', lane: 'defense', tier: 2,
            description: 'Cyber attacks last 35% shorter.', stat: '-35% cyber time', icon: 'vpn_lock',
            purchase: { cash: 12_000 },
            effects: [{ type: 'reduce_attack_duration', target: 'self', fraction: 0.35, category: 'cyber' }]
        },
        {
            id: 'def_redundancy', name: 'Redundant Assembly Lines', lane: 'defense', tier: 3,
            description: 'All attacks last 15% shorter.', stat: '-15% attack time', icon: 'layers',
            purchase: { cash: 70_000 },
            effects: [{ type: 'reduce_attack_duration', target: 'self', fraction: 0.15 }]
        },
        {
            id: 'def_vaults', name: 'Reinforced Warehouse Vaults', lane: 'defense', tier: 3,
            description: 'Warehouse Heists steal 30% fewer of your phones.', stat: '-30% theft', icon: 'inventory',
            purchase: { cash: 110_000, research: 75 },
            effects: [{ type: 'reduce_theft', target: 'self', fraction: 0.30 }]
        },
        {
            id: 'def_shield', name: 'Emergency Factory Lockdown', lane: 'defense', tier: 3,
            description: 'Unlocks Lockdown, which weakens incoming attacks by 70% for 12 seconds.', stat: '-70% hits, 12s', icon: 'lock',
            purchase: { cash: 180_000, research: 125 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_lockdown' }]
        },
        {
            id: 'def_geo', name: 'Geographic Diversification', lane: 'defense', tier: 4,
            description: 'Mitigates 12% of incoming sabotage.', stat: '+12% mitigation', icon: 'language',
            purchase: { cash: 700_000, research: 200 },
            effects: [{ type: 'add_mitigation', target: 'self', fraction: 0.12 }]
        },
        {
            id: 'def_decoys', name: 'Decoy Production Lines', lane: 'defense', tier: 4,
            description: 'Each incoming attack has a 35% chance to hit a decoy and do nothing.', stat: '35% to dodge', icon: 'filter_none',
            purchase: { cash: 1_100_000, research: 300 },
            effects: [{ type: 'whiff_chance', target: 'self', chance: 0.35 }]
        },
        {
            id: 'def_restore', name: 'Instant Recovery Protocol', lane: 'defense', tier: 4,
            description: 'Unlocks Rapid Recovery, which cleanses every active attack.', stat: 'Cleanses all', icon: 'restore',
            purchase: { cash: 1_500_000, research: 500 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_rapid_recovery' }]
        },
        {
            id: 'def_quantum_crypto', name: 'Quantum-Secure Factory OS', lane: 'defense', tier: 5,
            description: 'Cyber attacks last 55% shorter and Warehouse Heists steal 25% fewer phones.', stat: '-55% cyber time', icon: 'enhanced_encryption',
            purchase: { cash: 6_500_000, research: 1_000 },
            effects: [
                { type: 'reduce_attack_duration', target: 'self', fraction: 0.55, category: 'cyber' },
                { type: 'reduce_theft', target: 'self', fraction: 0.25 }
            ]
        },
        {
            id: 'def_global_backup', name: 'Planetwide Spare Capacity', lane: 'defense', tier: 5,
            description: 'While sabotaged, production is boosted by 15%.', stat: '+15% under attack', icon: 'backup',
            purchase: { cash: 11_000_000, research: 1_600 },
            effects: [{ type: 'multiply_while_sabotaged', target: 'self', factor: 1.15 }]
        },
        {
            id: 'def_immunity', name: 'Autonomous Defense Grid', lane: 'defense', tier: 5,
            description: 'Unlocks Defense Grid, which fully blocks the next incoming attack within 15 seconds.', stat: 'Blocks 1 attack', icon: 'shield',
            purchase: { cash: 17_000_000, research: 2_200 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_defense_grid' }]
        },

        {
            id: 'atk_bad_reviews', name: 'Fake Review Campaign', lane: 'offense', tier: 1,
            description: 'Unlocks a marketing attack: -15% production for 18 seconds.', stat: '-15% PPS, 18s', icon: 'thumb_down',
            purchase: { cash: 360 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_bad_reviews' }]
        },
        {
            id: 'atk_component_delay', name: 'Component Shipment Delay', lane: 'offense', tier: 1,
            description: 'Unlocks a supply attack: -20% production for 15 seconds.', stat: '-20% PPS, 15s', icon: 'local_shipping',
            purchase: { cash: 560 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_component_delay' }]
        },
        {
            id: 'atk_heist', name: 'Warehouse Heist', lane: 'offense', tier: 1,
            description: 'Unlocks a raid that steals phones from a rival: 3% of theirs if they are behind you, up to 20% if they are ahead. You sell what you steal.', stat: 'Steal phones!', icon: 'warehouse',
            purchase: { cash: 400 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_heist' }]
        },
        {
            id: 'atk_poach', name: 'Engineer Poaching', lane: 'offense', tier: 2,
            description: 'Unlocks a workforce attack: -25% production for 18 seconds.', stat: '-25% PPS, 18s', icon: 'person_remove',
            purchase: { cash: 3_200 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_poach' }]
        },
        {
            id: 'atk_price_war', name: 'Aggressive Price War', lane: 'offense', tier: 2,
            description: 'Unlocks a revenue attack: -30% cash per phone for 25 seconds. Production is unaffected.', stat: '-30% cash, 25s', icon: 'price_change',
            purchase: { cash: 6_400 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_price_war' }]
        },
        {
            id: 'atk_shipping', name: 'Port Congestion', lane: 'offense', tier: 2,
            description: 'Unlocks a supply attack: -30% production for 16 seconds.', stat: '-30% PPS, 16s', icon: 'directions_boat',
            purchase: { cash: 10_400 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_shipping' }]
        },
        {
            id: 'atk_ransomware', name: 'Factory Ransomware', lane: 'offense', tier: 3,
            description: 'Unlocks a cyber attack: -35% production for 16 seconds.', stat: '-35% PPS, 16s', icon: 'lock_open',
            purchase: { cash: 68_000, research: 60 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_ransomware' }]
        },
        {
            id: 'atk_patent', name: 'Patent Lawsuit', lane: 'offense', tier: 3,
            description: 'Unlocks a revenue attack: -40% cash per phone for 30 seconds.', stat: '-40% cash, 30s', icon: 'gavel',
            purchase: { cash: 104_000, research: 80 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_patent' }]
        },
        {
            id: 'atk_power', name: 'Power Grid Disruption', lane: 'offense', tier: 3,
            description: 'Unlocks a power attack: -40% production for 14 seconds.', stat: '-40% PPS, 14s', icon: 'power_off',
            purchase: { cash: 152_000, research: 120 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_power' }]
        },
        {
            id: 'atk_chip', name: 'Chip Supply Embargo', lane: 'offense', tier: 4,
            description: 'Unlocks a supply attack: -45% production for 16 seconds.', stat: '-45% PPS, 16s', icon: 'block',
            purchase: { cash: 600_000, research: 200 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_chip' }]
        },
        {
            id: 'atk_botnet', name: 'Botnet Factory Attack', lane: 'offense', tier: 4,
            description: 'Unlocks a cyber attack: -50% production for 12 seconds.', stat: '-50% PPS, 12s', icon: 'bug_report',
            purchase: { cash: 960_000, research: 280 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_botnet' }]
        },
        {
            id: 'atk_media', name: 'Product Recall Hoax', lane: 'offense', tier: 4,
            description: 'Unlocks a revenue attack: -50% cash per phone for 25 seconds.', stat: '-50% cash, 25s', icon: 'campaign',
            purchase: { cash: 1_280_000, research: 400 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_media' }]
        },
        {
            id: 'atk_satellite', name: 'Satellite Logistics Jam', lane: 'offense', tier: 5,
            description: 'Unlocks a supply attack: -55% production for 12 seconds.', stat: '-55% PPS, 12s', icon: 'satellite',
            purchase: { cash: 5_600_000, research: 800 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_satellite' }]
        },
        {
            id: 'atk_emp', name: 'Precision EMP Raid', lane: 'offense', tier: 5,
            description: 'Unlocks a power attack: -60% production for 10 seconds.', stat: '-60% PPS, 10s', icon: 'flash_off',
            purchase: { cash: 9_600_000, research: 1_360 },
            effects: [{ type: 'unlock_ability', target: 'self', abilityId: 'ability_emp' }]
        },
        {
            id: 'atk_mole', name: 'Corporate Mole Network', lane: 'offense', tier: 5,
            description: 'Your attacks last 10% longer before defenses, up to 2 seconds.', stat: '+10% attack time', icon: 'badge',
            purchase: { cash: 14_400_000, research: 1_760 },
            effects: [{ type: 'modify_attack_duration', target: 'self', fraction: 0.10, capSec: 2 }]
        }
    ],
    abilities: [
        {
            id: 'ability_emergency_patch', name: 'Emergency Patch', verb: 'Patch', kind: 'defense',
            sourceUpgradeId: 'def_patch', activation: { cash: 1_000 }, cooldownSec: 180,
            effects: [{ type: 'cleanse_debuffs', target: 'self', count: 1 }]
        },
        {
            id: 'ability_lockdown', name: 'Lockdown', verb: 'Lock down', kind: 'defense',
            sourceUpgradeId: 'def_shield', activation: { cash: 35_000 }, cooldownSec: 100,
            effects: [{ type: 'temporary_mitigation', target: 'self', fraction: 0.70, durationSec: 12 }]
        },
        {
            id: 'ability_rapid_recovery', name: 'Rapid Recovery', verb: 'Recover', kind: 'defense',
            sourceUpgradeId: 'def_restore', activation: { cash: 250_000 }, cooldownSec: 130,
            effects: [{ type: 'cleanse_debuffs', target: 'self', durationSec: 3 }]
        },
        {
            id: 'ability_defense_grid', name: 'Defense Grid', verb: 'Arm grid', kind: 'defense',
            sourceUpgradeId: 'def_immunity', activation: { cash: 2_000_000 }, cooldownSec: 160,
            effects: [{ type: 'block_next_attack', target: 'self', durationSec: 15 }]
        },
        {
            id: 'ability_bad_reviews', name: 'Fake Reviews', verb: 'Smear', kind: 'attack',
            sourceUpgradeId: 'atk_bad_reviews', activation: { cash: 150, influence: 20 }, cooldownSec: 15,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.15, category: 'marketing', durationSec: 18 }]
        },
        {
            id: 'ability_component_delay', name: 'Delay Shipment', verb: 'Delay', kind: 'attack',
            sourceUpgradeId: 'atk_component_delay', activation: { cash: 250, influence: 25 }, cooldownSec: 17,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.20, category: 'supply', durationSec: 15 }]
        },
        {
            id: 'ability_heist', name: 'Warehouse Heist', verb: 'Raid', kind: 'attack',
            sourceUpgradeId: 'atk_heist', activation: { cash: 125, influence: 35 }, cooldownSec: 90,
            effects: [{ type: 'steal_phones', target: 'selectedOpponent' }]
        },
        {
            id: 'ability_poach', name: 'Poach Engineers', verb: 'Poach', kind: 'attack',
            sourceUpgradeId: 'atk_poach', activation: { cash: 1_000, influence: 30 }, cooldownSec: 22,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.25, category: 'workforce', durationSec: 18 }]
        },
        {
            id: 'ability_price_war', name: 'Price War', verb: 'Undercut', kind: 'attack',
            sourceUpgradeId: 'atk_price_war', activation: { cash: 2_000, influence: 30 }, cooldownSec: 22,
            effects: [{ type: 'activate_revenue_slow', target: 'selectedOpponent', fraction: 0.30, category: 'marketing', durationSec: 25 }]
        },
        {
            id: 'ability_shipping', name: 'Port Congestion', verb: 'Block port of', kind: 'attack',
            sourceUpgradeId: 'atk_shipping', activation: { cash: 3_000, influence: 35 }, cooldownSec: 23,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.30, category: 'supply', durationSec: 16 }]
        },
        {
            id: 'ability_ransomware', name: 'Ransomware', verb: 'Encrypt', kind: 'attack',
            sourceUpgradeId: 'atk_ransomware', activation: { cash: 12_500, influence: 40 }, cooldownSec: 27,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.35, category: 'cyber', durationSec: 16 }]
        },
        {
            id: 'ability_patent', name: 'Patent Lawsuit', verb: 'Sue', kind: 'attack',
            sourceUpgradeId: 'atk_patent', activation: { cash: 17_500, influence: 40 }, cooldownSec: 27,
            effects: [{ type: 'activate_revenue_slow', target: 'selectedOpponent', fraction: 0.40, category: 'legal', durationSec: 30 }]
        },
        {
            id: 'ability_power', name: 'Grid Disruption', verb: 'Black out', kind: 'attack',
            sourceUpgradeId: 'atk_power', activation: { cash: 22_500, influence: 45 }, cooldownSec: 30,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.40, category: 'power', durationSec: 14 }]
        },
        {
            id: 'ability_chip', name: 'Chip Embargo', verb: 'Embargo', kind: 'attack',
            sourceUpgradeId: 'atk_chip', activation: { cash: 100_000, influence: 50 }, cooldownSec: 32,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.45, category: 'supply', durationSec: 16 }]
        },
        {
            id: 'ability_botnet', name: 'Botnet Attack', verb: 'Hack', kind: 'attack',
            sourceUpgradeId: 'atk_botnet', activation: { cash: 150_000, influence: 55 }, cooldownSec: 35,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.50, category: 'cyber', durationSec: 12 }]
        },
        {
            id: 'ability_media', name: 'Recall Hoax', verb: 'Smear', kind: 'attack',
            sourceUpgradeId: 'atk_media', activation: { cash: 175_000, influence: 45 }, cooldownSec: 33,
            effects: [{ type: 'activate_revenue_slow', target: 'selectedOpponent', fraction: 0.50, category: 'marketing', durationSec: 25 }]
        },
        {
            id: 'ability_satellite', name: 'Satellite Jam', verb: 'Jam', kind: 'attack',
            sourceUpgradeId: 'atk_satellite', activation: { cash: 750_000, influence: 60 }, cooldownSec: 38,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.55, category: 'supply', durationSec: 12 }]
        },
        {
            id: 'ability_emp', name: 'EMP Raid', verb: 'Raid', kind: 'attack',
            sourceUpgradeId: 'atk_emp', activation: { cash: 1_250_000, influence: 65 }, cooldownSec: 42,
            effects: [{ type: 'activate_slow', target: 'selectedOpponent', fraction: 0.60, category: 'power', durationSec: 10 }]
        }
    ]
};
