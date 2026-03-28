// US States for deer hunting
export const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
] as const

export const HIGH_OUTPUT_STATES = ['IL', 'IA', 'WI', 'KS', 'OH', 'IN', 'MO', 'KY', 'NE', 'MN'] as const
export const LOW_OUTPUT_STATES = ['AZ', 'NV', 'NM', 'CA', 'WA', 'OR', 'UT'] as const

// Phase 41: Geographic region groupings for segmented calibration
export const MIDWEST_STATES = ['IL', 'IA', 'WI', 'OH', 'IN', 'MO', 'MN', 'MI', 'ND', 'SD', 'WI'] as const
export const SOUTH_STATES   = ['TX', 'AL', 'MS', 'GA', 'FL', 'SC', 'NC', 'TN', 'AR', 'LA', 'KY', 'VA', 'WV', 'OK'] as const
export const NORTHEAST_STATES = ['NY', 'PA', 'VT', 'NH', 'ME', 'MA', 'CT', 'RI', 'NJ', 'DE', 'MD'] as const
export const PLAINS_STATES  = ['KS', 'NE', 'CO', 'WY', 'MT', 'ID'] as const
export const WEST_STATES    = ['AZ', 'NV', 'NM', 'CA', 'WA', 'OR', 'UT'] as const

export const RACK_TYPES = [
  { value: 'typical', label: 'Typical' },
  { value: 'non-typical', label: 'Non-Typical' },
] as const

export const HARVEST_METHODS = [
  { value: 'bow', label: 'Bow' },
  { value: 'rifle', label: 'Rifle' },
  { value: 'muzzleloader', label: 'Muzzleloader' },
  { value: 'crossbow', label: 'Crossbow' },
  { value: 'other', label: 'Other' },
] as const

export const SOURCE_TYPES = [
  { value: 'live_deer', label: 'Live Deer' },
  { value: 'harvest_photo', label: 'Post-Kill Photo' },
  { value: 'mounted_photo', label: 'Mounted Buck Photo' },
  { value: 'european_mount', label: 'European Mount' },
  { value: 'trail_cam', label: 'Trail Camera' },
  { value: 'other', label: 'Other / Unknown' },
] as const

export const CAPTURE_DEVICES = [
  { value: 'iphone', label: 'iPhone' },
  { value: 'android', label: 'Android' },
  { value: 'digital_camera', label: 'Digital Camera' },
  { value: 'photo_of_photo', label: 'Photo of a Photo' },
  { value: 'vintage_photo', label: 'Vintage Photo' },
  { value: 'unknown', label: 'Unknown' },
] as const

export const MAIN_FRAME_OPTIONS = [8, 9, 10, 11, 12, 13, 14]

export const ANGLE_TYPES = [
  { value: 'front', label: 'Front' },
  { value: 'left', label: 'Left Side' },
  { value: 'right', label: 'Right Side' },
  { value: 'back', label: 'Back' },
  { value: 'other', label: 'Other' },
] as const

export const SCORE_SOURCES = [
  { value: 'official_scorer', label: 'Official Scorer (B&C/P&Y)' },
  { value: 'self_measured', label: 'Self Measured' },
  { value: 'user_reported', label: 'User Reported' },
  { value: 'estimated', label: 'Estimated' },
] as const

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 75,
  MEDIUM: 50,
  LOW: 25,
} as const

export const ANATOMICAL_REFERENCES = {
  EAR_BASE_TO_TIP: 6.25,
  EYE_TO_EYE: 4.3,
  EAR_TIP_TO_TIP_ALERT: 16.0,
  EAR_TIP_TO_TIP_RELAXED: 14.0,
} as const

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const
export const MAX_FILE_SIZE = 20 * 1024 * 1024
export const MAX_IMAGES = 10
export const RECOMMENDED_IMAGES = 4

export const SCORING_DISCLAIMER = `This is an AI estimate, not an official score. Official Boone & Crockett or Pope & Young scoring requires physical measurement by a certified scorer. Confidence levels reflect image quality, metadata quality, and angle diversity. Multi-angle submissions provide higher accuracy.`
