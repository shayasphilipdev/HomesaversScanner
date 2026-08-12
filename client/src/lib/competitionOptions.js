// Dropdown vocab for the Competition capture screen. Kept client-side (the
// retailer name list is DB-backed and user-extensible; these coded values are
// fixed). Values are stored verbatim and exported for analysis outside the app,
// so keep them stable once live.

export const RETAILER_TYPES = [
  'Discount variety / value',
  'Supermarket / grocery',
  'Convenience / corner shop / newsagent',
  'FMCG / grocery multiple',
  'Cash & carry / wholesale',
  'Pharmacy / health & beauty',
  'Cosmetics / beauty',
  'Homeware',
  'Household / cleaning / hardware',
  'Furniture',
  'Electrical / appliances',
  'Mobile / phone / tech',
  'DIY / hardware / builders',
  'Garden centre',
  'Clothing / fashion',
  'Footwear',
  'Sports / outdoor',
  'Toys / games',
  'Books / stationery / cards / gifts',
  'Pet store',
  'Off-licence / drinks',
  'Fresh food (butcher / greengrocer / bakery)',
  'Deli / food-to-go',
  'Department store',
  'Charity shop',
  'Other',
]

export const SIZE_VS_US = ['Much smaller', 'Smaller', 'Similar', 'Larger', 'Much larger']

export const STATUS_OPTIONS = [
  'Established',
  'Recently opened',
  'Newly opened',
  'Opening soon',
  'Refurbished / expanded',
  'Downsizing',
  'Closing down',
  'Recently closed',
  'Relocated',
]

export const DISTANCE_BANDS = [
  'Same park / parade',
  'Adjacent / next door',
  '< 5 min',
  '5–15 min',
  '15–30 min',
  '30+ min',
]

export const TRAVEL_OPTIONS = ['Walkable', 'By car']

export const DIRECT_OPTIONS = ['Direct', 'Partial overlap', 'Minimal overlap', 'Not a competitor']

export const PRICE_VS_US = ['Much cheaper', 'Cheaper', 'Similar', 'Dearer', 'Much dearer', 'Varies']

export const THREAT_OPTIONS = ['Very low', 'Low', 'Medium', 'High', 'Very high']

export const SETTING_OPTIONS = [
  'High street',
  'Shopping centre',
  'Retail park',
  'Standalone / roadside',
  'Neighbourhood parade',
  'Town centre',
]

export const DISTANCE_UNITS = ['metres', 'km']

// Column keys + Excel headers for the Competition report table (mirrors the
// server's /competitors/report output so the Reports tab can render + export).
export const COMPETITION_REPORT_COLS = [
  'store_code', 'store_name', 'region', 'retailer_name', 'retailer_type', 'size_vs_us',
  'distance_band', 'distance_value', 'distance_unit', 'travel', 'status', 'direct',
  'price_vs_us', 'threat', 'setting', 'details', 'collected_by', 'collected_at',
  'updated_by', 'updated_at',
]
export const COMPETITION_REPORT_HEADERS = [
  'Store Code', 'Store Name', 'Region', 'Retailer', 'Type', 'Size vs Us',
  'Distance Band', 'Distance', 'Unit', 'Travel', 'Status', 'Direct',
  'Price vs Us', 'Threat', 'Setting', 'Details', 'Collected By', 'Collected At',
  'Updated By', 'Last Updated',
]
