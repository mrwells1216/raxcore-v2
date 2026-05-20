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

// Phase 54: Abnormal/Irregular Point Tags
export const ABNORMAL_POINT_TAGS = [
  { value: 'drop_tine', label: 'Drop Tine', description: 'A tine that grows downward from the main beam' },
  { value: 'sticker_point', label: 'Sticker Point', description: 'A small abnormal point growing from another point or beam' },
  { value: 'split_tine', label: 'Split Tine', description: 'A tine that splits into two or more points' },
  { value: 'extra_abnormal_growth', label: 'Extra Abnormal Growth', description: 'Additional growth beyond normal tine structure' },
  { value: 'palmation_like_growth', label: 'Palmation-like Growth', description: 'Flat, palm-like antler growth similar to moose' },
  { value: 'kicker_point', label: 'Kicker Point', description: 'A point growing from the base/burr area' },
  { value: 'inline_point', label: 'Inline Point', description: 'A point growing inline with the main beam' },
  { value: 'unknown_abnormality', label: 'Other / Unknown', description: 'Other abnormal features not listed' },
] as const

export const YES_NO_UNSURE_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Unsure' },
] as const

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

// Published whitetail adult-buck anatomical means (in inches). Sources cross-
// referenced from Boone & Crockett scoring literature and biological surveys.
// Update with caution — these are the ground truth that every anatomical-prior
// calibration depends on. Per-reference notes:
//   - "front-projected" values are what a front-facing camera sees, not the true
//     3D length. The snout is heavily foreshortened from the front.
//   - "skull-fixed" means the landmark moves with the skull (ear bases, pedicles),
//     which is what we want for calibration; ear tips are mobile and unreliable.
export const ANATOMICAL_REFERENCES = {
  // ── Ear references (skull-fixed bases are usable; tips are mobile/unreliable)
  EAR_BASE_TO_TIP: 6.25,       // base to tip when ears are forward
  EAR_TIP_TO_TIP_ALERT: 16.0,
  EAR_TIP_TO_TIP_RELAXED: 14.0,
  EAR_BASE_SPACING: 5.5,       // center-to-center of skull-fixed ear bases (front view)

  // ── Top-tier: eye box dimensions
  EYE_TO_EYE: 4.3,             // center-to-center of pupils (front view)
  EYE_WIDTH: 1.4,              // horizontal width of one eye socket
  EYE_HEIGHT: 0.9,             // vertical height of one eye socket
  EYE_BOX_WIDTH: 1.4,          // full bony eye socket box width
  EYE_BOX_HEIGHT: 1.0,         // full bony eye socket box height

  // ── Top-tier: antler base / pedicle spacing
  PEDICLE_SPACING: 3.8,        // center-to-center of antler pedicles on skull
  EYE_TO_PEDICLE: 2.1,         // distance from eye center to nearest pedicle base

  // ── Top-tier: skull / forehead width
  // NOTE: there is no dedicated "orbital_ridge_left/right" landmark, so consumers
  // that want skull-width calibration MUST NOT reuse pedicle endpoints with this
  // value — that just produces an inconsistent px/in derived from the same pixel
  // distance as PEDICLE_SPACING (see per-image-consensus.ts).
  SKULL_FOREHEAD_WIDTH: 5.2,   // forehead width between orbital ridges (front view)

  // ── Secondary: nose bridge and muzzle
  // The visible front-view nasal-bone bridge from brow to nose tip projects to
  // about 2.8" because the snout is foreshortened toward the camera. The true
  // 3D snout length is closer to 5.5-6.5". This value is therefore ONLY usable
  // on a true front-facing photo as a cross-check, never as primary calibration.
  NOSE_BRIDGE_LENGTH: 2.8,     // FRONT-PROJECTED bridge length (not true 3D)
  MUZZLE_WIDTH: 2.6,           // muzzle width at widest point (front view)
} as const

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const
export const MAX_FILE_SIZE = 20 * 1024 * 1024
export const MAX_IMAGES = 10
export const RECOMMENDED_IMAGES = 4

export const SCORING_DISCLAIMER = `This is an AI estimate, not an official score. Official Boone & Crockett or Pope & Young scoring requires physical measurement by a certified scorer. Confidence levels reflect image quality, metadata quality, and angle diversity. Multi-angle submissions provide higher accuracy.`
