import { t } from "../i18n";

export type Photo = {
  id: string;
  declared_key: string;
  object_name?: string | null;
  title: string;
  caption: string;
  licence: string;
  captured_at: string;
  equipment: string;
  processing: string;
  composite: boolean;
  wcs?: import("./photoFootprint").Wcs | null;
  in_frame?: {
    key: string;
    name: string;
    x: number;
    y: number;
    role: string;
  }[];
  author: { handle: string; name: string };
  votes: number;
  thumbnail_url: string;
  image_url: string;
};
export type Cover = {
  subject_id: string;
  keys: string[];
  name: string;
  count: number;
  cover: Photo | null;
  new_photo?: Photo | null;
  new_photo_until?: string | null;
};
export type User = { id: string; handle: string; name: string; role: string };
/** A photo of the signed-in photographer, with its private status. */
export type OwnPhoto = {
  id: string;
  title: string;
  status: string;
  declared_key?: string;
  object_name?: string | null;
  thumbnail_url?: string | null;
  votes?: number;
  inserted_at?: string;
  moderation_reason?: string | null;
};
export type Photographer = {
  handle: string;
  name: string;
  h_index: number;
  photos: number;
  objects?: number;
  votes?: number;
  covers?: number;
  first_photos?: number;
  rank?: number;
  joined_at?: string;
};
export type CoverageObject = {
  key: string;
  name: string;
  catalog?: string;
  type?: string | null;
  constellation?: string | null;
  magnitude?: number | null;
};
export type Coverage = {
  total?: number;
  covered?: number;
  matched?: number;
  catalogs?: Record<string, { total: number; covered: number }>;
  objects: CoverageObject[];
};
/** The private view of a photo for a moderator. */
export type ReviewPhoto = Photo & {
  status?: string;
  submitted_at?: string;
  width?: number | null;
  height?: number | null;
  author: Photo["author"] & { joined_at?: string; suspended?: boolean; published?: number; rejected?: number };
  duplicates?: { id: string; title: string; status: string; handle: string }[];
  reports?: { reason: string; at?: string }[];
  last_action?: { action: string; reason: string; at: string; moderator?: string | null } | null;
};
export type ReviewQueue = {
  counts?: Record<string, number>;
  photos: ReviewPhoto[];
  reports: { id?: string; reason: string; at?: string; photo: ReviewPhoto }[];
};
export type ReviewAction = {
  action: string;
  reason: string;
  at: string;
  moderator?: string | null;
  photo_id?: string | null;
  photo_title?: string | null;
};

/** Error codes of the server that have a text of their own. Other codes get the general text. */
const ERROR_KEYS = new Set([
  "account_too_new",
  "vote_not_allowed",
  "solver_unavailable",
  "mail_unavailable",
  "sign_in_required",
  "invalid_code",
  "invalid_metadata",
  "upload_quota",
  "not_ready",
  "invalid_wcs",
]);

export class CommunityApi {
  user: User | null = null;
  csrf = "";
  /** Photos and reports that wait for this moderator. Zero for a member. */
  reviewCount = 0;
  async request<T>(
    path: string,
    method = "GET",
    data?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        ...(method === "GET"
          ? {}
          : {
              "content-type": "application/json",
              "x-community-csrf": this.csrf,
            }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(t(ERROR_KEYS.has(payload.error) ? `community.error.${payload.error}` : "community.error.generic"));
    }
    return response.json() as Promise<T>;
  }
  async session() {
    try {
      const data = await this.request<{ user: User | null; csrf: string; review_count?: number }>(
        "/api/community/session",
      );
      this.user = data.user;
      this.csrf = data.csrf;
      this.reviewCount = data.review_count ?? 0;
    } catch {
      this.user = null;
      this.csrf = "";
      this.reviewCount = 0;
    }
  }
  get moderator() {
    return ["admin", "moderator"].includes(this.user?.role ?? "");
  }
  signOutLocally() {
    this.user = null;
    this.csrf = "";
    this.reviewCount = 0;
  }
}

/** The text of an error for the status line of a window. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : t("community.error.generic");
}
