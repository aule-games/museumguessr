/* Generated from data/items.schema.json by `npm run types`. Do not edit. */

/**
 * This interface was referenced by `ItemsFile`'s JSON-Schema
 * via the `definition` "Item".
 */
export type Item = Item1;
/**
 * The holding museum's own object record.
 */
export type HttpsUrl = string;
/**
 * This interface was referenced by `ItemsFile`'s JSON-Schema
 * via the `definition` "HttpsUrl".
 */
export type HttpsUrl1 = string;
/**
 * Page that states the photo's licence.
 */
export type HttpsUrl2 = string;
/**
 * Direct URL of the original image file.
 */
export type HttpsUrl3 = string;

/**
 * MuseumGuessr content. Fields are grouped by question: kept, made, when. See docs/content.md.
 */
export interface ItemsFile {
  $schema?: string;
  items: Item[];
}
export interface Item1 {
  /**
   * Opaque two-digit id, never derived from the title or place, never reused (DS6, ENG10). The image is images/<id>.jpg.
   */
  id: string;
  title: string;
  /**
   * Alt text during the round: material, form, figures, composition; no title, artist, place, culture or date (A1, DS29).
   */
  alt_neutral: string;
  record_url: HttpsUrl;
  /**
   * The object's own Wikidata item, or null when none exists.
   */
  wikidata_url: string | null;
  kept: Kept;
  made: Made;
  when: When;
  /**
   * True when the holding city lies outside the made place.
   */
  moved: boolean;
  /**
   * How it reached its current collection; documented transfers with sources, gaps stated as 'not documented' (E3, PV1). Required when moved is true.
   */
  journey_fact: {
    text: string;
    source_url: HttpsUrl1;
  } | null;
  /**
   * @minItems 1
   * @maxItems 2
   */
  facts:
    | [
        {
          text: string;
          source_url: HttpsUrl1;
        }
      ]
    | [
        {
          text: string;
          source_url: HttpsUrl1;
        },
        {
          text: string;
          source_url: HttpsUrl1;
        }
      ];
  photo: Photo;
  /**
   * Disagreements between the museum record and Wikidata; the museum record wins.
   */
  conflicts: string[];
  /**
   * Under a public restitution claim with a cited source (V8).
   */
  contested: boolean;
  /**
   * The claimant's published source, shown next to the museum's account (PV1). Required when contested is true.
   */
  claimant_source: SourcedText | null;
  /**
   * True when held in or made in Italy or Greece (H1).
   */
  heritage_image_law: boolean;
  retrieved: string;
}
/**
 * Where it is kept today: the holding museum and its city.
 *
 * This interface was referenced by `ItemsFile`'s JSON-Schema
 * via the `definition` "Kept".
 */
export interface Kept {
  museum: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  source_url: HttpsUrl1;
}
/**
 * Place of creation as named by the museum record (not the depicted place or find spot). Coordinates are the Wikidata P625 of that place item.
 *
 * This interface was referenced by `ItemsFile`'s JSON-Schema
 * via the `definition` "Made".
 */
export interface Made {
  place: string;
  country: string;
  precision: 'city' | 'region' | 'country';
  wikidata_url: string;
  lat: number;
  lng: number;
  source_url: HttpsUrl1;
  /**
   * Optional one-line clarification shown as the Made row's reason, e.g. 'Shows Venice; painted in London'.
   */
  note?: string | null;
  /**
   * Optional full-marks radius for this item, capped by its precision level (ENG12).
   */
  full_marks_km?: number | null;
}
/**
 * Date range from the museum record. Historical years, negative = BCE, no year 0.
 *
 * This interface was referenced by `ItemsFile`'s JSON-Schema
 * via the `definition` "When".
 */
export interface When {
  start: number;
  end: number;
  /**
   * The museum's own wording, e.g. 'ca. 1665'.
   */
  label: string;
  source_url: HttpsUrl1;
  /**
   * Optional one-line clarification shown in the When row's details, e.g. when the museum's own record gives more than one date.
   */
  note?: string | null;
}
/**
 * This interface was referenced by `ItemsFile`'s JSON-Schema
 * via the `definition` "Photo".
 */
export interface Photo {
  source_url: HttpsUrl2;
  file_url: HttpsUrl3;
  author: string;
  licence:
    | 'CC0 1.0'
    | 'Public domain'
    | 'PD-Art'
    | 'CC BY 2.0'
    | 'CC BY 2.5'
    | 'CC BY 3.0'
    | 'CC BY 4.0'
    | 'CC BY-SA 2.0'
    | 'CC BY-SA 2.5'
    | 'CC BY-SA 3.0'
    | 'CC BY-SA 4.0';
  /**
   * Why the artwork itself is public domain.
   */
  pd_basis: string;
  crop_note?: string | null;
}
/**
 * This interface was referenced by `ItemsFile`'s JSON-Schema
 * via the `definition` "SourcedText".
 */
export interface SourcedText {
  text: string;
  source_url: HttpsUrl1;
}
