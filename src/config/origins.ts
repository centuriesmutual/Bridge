/**
 * Property registry + allowlisted frontend origins.
 *
 * Every inbound request must resolve to exactly one property before any
 * chaincode is touched (see middleware/origin-auth.ts). Member IDs are
 * PROPERTY-SCOPED by default (e.g. `mbk:123`, `cm:123`) — we do NOT assume a
 * shared member identity across brands. See README "Open questions".
 */

export const PROPERTIES = [
  'centuries-mutual',
  'medicare-reviews',
  'wintergarden',
  'mybrotherskeeper',
] as const;

export type PropertyId = (typeof PROPERTIES)[number];

export interface PropertyConfig {
  id: PropertyId;
  /** Short prefix used to namespace member IDs on-ledger. */
  memberIdPrefix: string;
  /** Human label for docs/logs. */
  label: string;
  /**
   * Allowlisted browser origins for member-facing requests. Extra entries can
   * be layered in via env in a real deployment; these are the canonical hosts.
   */
  allowedOrigins: string[];
}

export const PROPERTY_CONFIG: Record<PropertyId, PropertyConfig> = {
  'centuries-mutual': {
    id: 'centuries-mutual',
    memberIdPrefix: 'cm',
    label: 'Centuries Mutual (insurance brokerage + Rewards Wallet)',
    allowedOrigins: [
      'https://centuriesmutual.com',
      'https://www.centuriesmutual.com',
      'https://developers.centuriesmutual.com',
    ],
  },
  'medicare-reviews': {
    id: 'medicare-reviews',
    memberIdPrefix: 'mr',
    label: 'Medicare Reviews (sponsored engagement wallet)',
    allowedOrigins: ['https://medicare.reviews', 'https://www.medicare.reviews'],
  },
  wintergarden: {
    id: 'wintergarden',
    memberIdPrefix: 'wg',
    label: 'Wintergarden (music scoring + real USDC payouts + merit badges)',
    allowedOrigins: [
      'https://wintergarden.cc',
      'https://www.wintergarden.cc',
      'https://wintergarden.software',
    ],
  },
  mybrotherskeeper: {
    id: 'mybrotherskeeper',
    memberIdPrefix: 'mbk',
    label: "My Brother's Keeper (walk-to-earn points)",
    allowedOrigins: ['https://mybrotherskeeper.cc', 'https://www.mybrotherskeeper.cc'],
  },
};

export function isPropertyId(value: string): value is PropertyId {
  return (PROPERTIES as readonly string[]).includes(value);
}

/** Resolve which property owns a given browser Origin, if any. */
export function propertyForOrigin(origin: string): PropertyId | null {
  const normalized = origin.trim().toLowerCase().replace(/\/$/, '');
  for (const cfg of Object.values(PROPERTY_CONFIG)) {
    if (cfg.allowedOrigins.some((o) => o.toLowerCase() === normalized)) {
      return cfg.id;
    }
  }
  return null;
}

/** Namespace a raw member ID under a property (e.g. `mbk:abc123`). */
export function scopedMemberId(property: PropertyId, rawMemberId: string): string {
  return `${PROPERTY_CONFIG[property].memberIdPrefix}:${rawMemberId}`;
}
