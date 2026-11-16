import "./page.css";
import { installAnalytics } from "../analytics";
installAnalytics();
const kind = document.querySelector<HTMLElement>("[data-marketing]")?.dataset.marketing;
if (kind === "spacecraft") void import("./spacecraftPage").then(m => m.mountSpacecraft());
if (kind === "tonight") void import("./tonightPage").then(m => m.mountTonight());
if (kind === "targets") void import("./targetsPage").then(m => m.mountTargets());
