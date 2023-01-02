/* eslint-disable @typescript-eslint/naming-convention */
export const UPDATE_EVERY_N_MS = 100;
export const MAX_PLAYERS = 20;

// Times are in seconds
export const GUESS_TIME = 14;
export const REVEAL_TIME = 4;
export const GRACE_LAG = 1;
export const TOTAL_ROUNDS = 12;

// Color data
export const OTHER_NAMES = {
    'EQVE': 'E116',
    // 'BRAN': 'E146',
    'GUN': 'GUNP',
    'HYGN': 'H2',
    'ICE': 'ICEI',
    'IGNC': 'IGNT',
    'INVS': 'INVIS',
    'LN2': 'LNTG',
    'LOXY': 'LO2',
    'BHOL': 'NBHL',
    'WHOL': 'NWHL',
    'OXYG': 'O2',
    'C-4': 'PLEX',
    'SHLD': 'SHLD1',
    'SHD2': 'SHLD2',
    'SHD3': 'SHLD3',
    'SHD4': 'SHLD4',
    'SPWN': 'SPAWN',
    'SPWN2': 'SPAWN2',
    'STK2': 'STKM2',
    'VENT': 'WHOL',
    'WWLD': 'WIRE',
    'TNT': 'BANG',
    'BUBW': 'CBNW',
    'BREC': 'BREL',
    'C-5': 'C5',
    'GOL': 'LIFE'
};
export const OTHER_NAMES_INV = Object.fromEntries(Object
    .entries(OTHER_NAMES)
    .map(([key, value]) => [value, key]));

export const ELEMENT_NAMES = ['ACEL', 'ACID', 'AMTR', 'ANAR', 'ARAY', 'BANG', 'BCLN', 'BCOL', 'BGLA', 'BHOL', 'BIZR', 'BIZRG', 'BIZRS', 'BMTL', 'BOMB', 'BOYL', 'BRAY', 'BRCK', 'BREC', 'BRMT', 'BTRY', 'BVBR', 'C5', 'CAUS', 'CBNW', 'CFLM', 'CLNE', 'CLST', 'CNCT', 'CO2', 'COAL', 'CONV', 'CRAY', 'CRMC', 'DCEL', 'DESL', 'DEST', 'DEUT', 'DLAY', 'DMG', 'DMND', 'DRAY', 'DRIC', 'DSTW', 'DTEC', 'DUST', 'DYST', 'E116', 'ELEC', 'EMBR', 'EMP', 'ETRD', 'EXOT', 'FIGH', 'FILT', 'FIRE', 'FIRW', 'FOG', 'FRAY', 'FRME', 'FRZW', 'FRZZ', 'FSEP', 'FUSE', 'FWRK', 'GAS', 'GBMB', 'GEL', 'GLAS', 'GLOW', 'GOLD', 'GOO', 'GPMP', 'GRAV', 'GRVT', 'GUNP', 'H2', 'HEAC', 'HSWC', 'ICEI', 'IGNT', 'INSL', 'INST', 'INVIS', 'INWR', 'IRON', 'ISOZ', 'ISZS', 'LAVA', 'LCRY', 'LDTC', 'LIFE', 'LIGH', 'LITH', 'LNTG', 'LO2', 'LOLZ', 'LOVE', 'LRBD', 'LSNS', 'MERC', 'METL', 'MORT', 'MWAX', 'NBHL', 'NBLE', 'NEUT', 'NICE', 'NITR', 'NONE', 'NSCN', 'NTCT', 'NWHL', 'O2', 'OIL', 'PBCN', 'PCLN', 'PHOT', 'PIPE', 'PLEX', 'PLNT', 'PLSM', 'PLUT', 'POLO', 'PPIP', 'PQRT', 'PROT', 'PRTI', 'PRTO', 'PSCN', 'PSNS', 'PSTE', 'PSTN', 'PSTS', 'PTCT', 'PTNM', 'PUMP', 'PVOD', 'QRTZ', 'RBDM', 'RFGL', 'RFRG', 'RIME', 'ROCK', 'RPEL', 'SALT', 'SAND', 'SAWD', 'SHLD1', 'SHLD2', 'SHLD3', 'SHLD4', 'SING', 'SLCN', 'SLTW', 'SMKE', 'SNOW', 'SOAP', 'SPAWN2', 'SPAWN', 'SPNG', 'SPRK', 'STKM2', 'STKM', 'STNE', 'STOR', 'SWCH', 'TESC', 'THDR', 'THRM', 'TRON', 'TSNS', 'TTAN', 'TUNG', 'URAN', 'VIBR', 'VINE', 'VIRS', 'VOID', 'VRSG', 'VRSS', 'VSNS', 'WARP', 'WATR', 'WAX', 'WHOL', 'WIFI', 'WIRE', 'WOOD', 'WTRV', 'YEST']
    .map(x => OTHER_NAMES_INV[x] || x);
