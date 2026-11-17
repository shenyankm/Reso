export const methodOfferFeature='method-offer-v1'
export const supportsMethodOffers=(value:unknown)=>typeof value==='string'&&value.split(',').map(v=>v.trim()).includes(methodOfferFeature)
