import { expect, test } from "@playwright/test";
import { communityFixture, photo } from "./community-fixtures";
import { openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

test("200 photo subjects keep navigation bounded against the same scene without photos", async ({ page }) => {
  test.setTimeout(120_000);
  await communityFixture(page);
  let enabled = false;
  let indexRequests = 0;
  const fixture = skyEphemerisFixture("2026-10-08T00:00:00Z");
  const objects = Array.from({length:200}, (_,i) => {
    const x = (i%15-7)*4.9, y = (Math.floor(i/15)-6)*3.5;
    return {...fixture.bodies[0],key:`fixture-${i}`,name:`Fixture ${i}`,radius_km:1,
      position:{...fixture.bodies[0].position,x_au:x,y_au:y,x_km:x*149597870.7,y_km:y*149597870.7}};
  });
  await page.route("**/api/ephemeris?**", r => r.fulfill({json:{...fixture,bodies:[...fixture.bodies,...objects]}}));
  await page.route("**/api/community/config", r => r.fulfill({json:{enabled}}));
  await page.route("**/api/photos/index?**", r => {
    indexRequests++;
    return r.fulfill({json:{version:1,more:false,items:objects.map((o,i)=>({subject_id:o.key,keys:[o.key],name:o.name,count:1,cover:{...photo,id:`photo-${i}`,declared_key:o.key}}))}});
  });
  const sample = async () => page.evaluate(async () => {
    const canvas = document.querySelector("#map")!;
    const intervals:number[]=[];
    let before = performance.now();
    for (let i=0; i<90; i++) {
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const now = performance.now();
      if (i>10) intervals.push(now-before);
      before=now;
      canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:i%2?1:-1,clientX:900,clientY:450,bubbles:true,cancelable:true}));
    }
    intervals.sort((a,b)=>a-b);
    return {median:intervals[Math.floor(intervals.length/2)],p95:intervals[Math.floor(intervals.length*0.95)]};
  });
  await openAtlas(page);
  const baseline = await sample();
  enabled=true;
  await openAtlas(page);
  await page.locator('[data-layer="photos"]').check({force:true});
  const cards=page.locator('#app > .community-marker-layer button');
  await expect.poll(()=>cards.count()).toBeGreaterThan(10);
  expect(await cards.count()).toBeLessThanOrEqual(24);
  const before=indexRequests;
  const photos=await sample();
  expect(indexRequests).toBe(before);
  expect(photos.p95).toBeLessThan(Math.max(50,baseline.p95*1.5));
  console.log(JSON.stringify({community_200_subjects:{baseline,photos,cards:await cards.count(),index_requests_during_navigation:indexRequests-before}}));
});
