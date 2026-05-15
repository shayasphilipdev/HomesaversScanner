export const UOM_OPTIONS = [
  { value: 'Gram',   label: 'Gram' },
  { value: 'KG',     label: 'KG' },
  { value: 'Litre',  label: 'Litre' },
  { value: 'ML',     label: 'ML' },
  { value: 'Metre',  label: 'Metre' },
  { value: 'CM',     label: 'CM' },
  { value: 'Packs',  label: 'Packs' },
  { value: 'PCS',    label: 'PCS' },
  { value: 'Nos',    label: 'Nos' },
  { value: 'Washes', label: 'Washes' },
  { value: 'Eachs',  label: 'Eachs (single piece)' },
]

// UOMs that come in packs — selecting Eachs here triggers the warning
export const PACK_WARNING_TRIGGER = 'Eachs'

export const EACHS_WARNING = {
  title: 'Eachs = single piece',
  body: 'This UOM means the product is sold as individual pieces. If this product comes in a pack, every item inside that pack must also be recorded with the same UOM. Please verify the pack contents before saving.'
}
