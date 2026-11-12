declare namespace AMap {
  interface AddressComponent {
    province: string
    city: string | string[]
    district: string
    township?: string
    street?: string
    streetNumber?: string
  }

  interface Regeocode {
    formattedAddress: string
    formatted_address?: string
    addressComponent: AddressComponent
  }

  interface GeocoderResult {
    info: string
    regeocode?: Regeocode
  }

  class Geocoder {
    constructor(options: { city?: string; radius?: number })
    getAddress(
      lnglat: [number, number],
      callback: (status: string, result: GeocoderResult) => void,
    ): void
  }

  function plugin(name: string | string[], callback: () => void): void
}

declare const AMap: {
  Geocoder: typeof AMap.Geocoder
  plugin: typeof AMap.plugin
}

interface Window {
  AMap?: typeof AMap
  _AMapSecurityConfig?: {
    securityJsCode?: string
    serviceHost?: string
  }
}
