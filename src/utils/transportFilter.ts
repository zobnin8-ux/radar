/** Транспорт и крупные конструкции — не гаджеты для канала */

const TRANSPORT_PATTERN =
  /\b(e-?bike|electric bike|electric bicycle|motorcycle|motorbike|cf\s*moto|evtol|e-?vtol|aircraft|airplane|aeroplane|fighter jet|jet fighter|helicopter|drone taxi|flying taxi|autonomous taxi|robotaxi|self-?driving car|self-?driving taxi|cybercab|cyber cab|sedan|suv|pickup truck|camper van|motorhome|mobile home|houseboat|yacht|sailboat|speedboat|kayak|canoe|ferry|concept bike|cargo bike|city bike|road bike|mountain bike|enduro motorcycle|lightweight enduro|kick\s*scooter|e-?scooter|electric scooter|unicycle|segway|hoverboard|skateboard|longboard|snowmobile|atv|quad bike|go-?kart|gokart|watercraft|submarine|speedboat|jet ski|jetski)\b/i;

const TAXI_AND_RIDESHARE =
  /\b(taxi\b|ride-?share|uber\s+(car|taxi|cab)|lyft|cab\s+service|autonomous vehicle)\b/i;

const ARCHITECTURE_PATTERN =
  /\b(tiny house|prefab home|modular home|outhouse|shed\b|prefab|building\b|aircraft carrier|skyscraper|container home)\b/i;

/** Аксессуары к авто/мото/самокату — пропускаем */
const ACCESSORY_EXCEPTION =
  /\b(mount|holder|dash\s*cam|dashcam|camera|vacuum|charger|cable|organizer|accessory|accessories|cover|case|light|lamp|tool|tracker|alarm|lock|sensor|adapter|hub|dock|phone|bicycle computer|bike light|bike mount|kickstand|helmet|gloves|bag for|pump for|repair kit|diagnostic|compressor|inflator|jump starter|registration|organizer)\b/i;

export function isTransportProduct(title: string, description?: string): boolean {
  const text = `${title} ${description ?? ""}`;
  if (ACCESSORY_EXCEPTION.test(text)) return false;
  return (
    TRANSPORT_PATTERN.test(text) ||
    TAXI_AND_RIDESHARE.test(text) ||
    ARCHITECTURE_PATTERN.test(text)
  );
}

export function transportRejectReason(title: string, description?: string): string | null {
  if (!isTransportProduct(title, description)) return null;
  return "транспорт/архитектура (не гаджет)";
}
