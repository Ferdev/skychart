import assert from "node:assert/strict";
import test from "node:test";
import { PhotoIndex } from "../src/community/photoIndex.ts";
const photo = {
  id: "photo",
  title: "Photo",
  declared_key: "m31",
  caption: "",
  licence: "All rights reserved",
  captured_at: "",
  equipment: "",
  processing: "",
  composite: false,
  author: { handle: "author", name: "Author" },
  votes: 0,
  thumbnail_url: "/image",
  image_url: "/image",
};
test("a cover is shared by object aliases and removed by a delta", () => {
  const index = new PhotoIndex();
  index.apply(
    [
      {
        subject_id: "subject",
        keys: ["m31", "ngc-224"],
        name: "M31",
        count: 1,
        cover: photo,
      },
    ],
    1,
  );
  assert.equal(index.get("m31"), index.get("ngc-224"));
  index.apply(
    [
      {
        subject_id: "subject",
        keys: ["m31", "ngc-224"],
        name: "M31",
        count: 0,
        cover: null,
      },
    ],
    2,
  );
  assert.equal(index.get("m31"), undefined);
  assert.equal(index.get("ngc-224"), undefined);
});
test("a stale response cannot restore a removed photo; alias corrections remove old aliases", () => {
  const index = new PhotoIndex();
  index.apply(
    [
      {
        subject_id: "subject",
        keys: ["old"],
        name: "Object",
        count: 1,
        cover: photo,
      },
    ],
    5,
  );
  index.apply(
    [
      {
        subject_id: "subject",
        keys: ["new"],
        name: "Object",
        count: 1,
        cover: photo,
      },
    ],
    6,
  );
  assert.equal(index.get("old"), undefined);
  assert.equal(index.get("new")?.cover?.id, "photo");
  index.apply(
    [
      {
        subject_id: "subject",
        keys: ["old"],
        name: "Object",
        count: 1,
        cover: photo,
      },
    ],
    4,
  );
  assert.equal(index.get("old"), undefined);
});
test("new-photo exposure stays stable across aliases and stops after expiry", () => {
  let exposed = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const index = new PhotoIndex(seed);
    const item = {subject_id:"subject",keys:["m31","ngc-224"],name:"M31",count:2,cover:photo,new_photo:{...photo,id:"new"},new_photo_until:new Date(Date.now()+60_000).toISOString()};
    index.apply([item], 1);
    if (index.get("m31")?.cover?.id === "new") exposed++;
    assert.equal(index.get("m31"), index.get("ngc-224"));
    index.apply([item], 2);
    assert.equal(index.get("m31")?.cover?.id, index.get("ngc-224")?.cover?.id);
    index.apply([{...item,new_photo_until:"2000-01-01T00:00:00Z"}], 3);
    assert.equal(index.get("m31")?.cover?.id, "photo");
  }
  assert.ok(exposed >= 1400 && exposed <= 1600, String(exposed));
});
