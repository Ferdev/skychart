import { cx } from "./copy";
export type Photo = {
  id: string;
  declared_key: string;
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
export class CommunityApi {
  user: User | null = null;
  csrf = "";
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
      const messages: Record<string, string> = {
        account_too_new: "You can vote 24 hours after creating your account.",
        vote_not_allowed: "You cannot vote on this photo.",
        solver_unavailable: "The plate solver is not configured for this site.",
        mail_unavailable:
          "Email delivery is unavailable. Please try again later.",
        sign_in_required: "Please sign in first.",
        invalid_code: "The code is incorrect or expired.",
        invalid_metadata:
          "Check the photo details and confirm your rights to publish.",
        upload_quota: "You reached the limit of 20 uploads per day.",
        not_ready: "Wait for image processing to finish.",
        invalid_wcs: "Use valid square-pixel TAN sky coordinates.",
      };
      throw new Error(
        cx(messages[payload.error] ?? "Request failed. Please try again."),
      );
    }
    return response.json() as Promise<T>;
  }
  async session() {
    try {
      const data = await this.request<{ user: User; csrf: string }>(
        "/api/community/session",
      );
      this.user = data.user;
      this.csrf = data.csrf;
    } catch {
      this.user = null;
      this.csrf = "";
    }
  }
}
