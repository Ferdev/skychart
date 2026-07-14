import type { CatalogPointSelector } from "../catalog/catalogPointSelector";
import type { ObjectInspectionView } from "./objectInspectionView";
import type { Body, CatalogPointHitEntry, ObjectDetailHydrationState, SelectBodyOptions } from "../atlas/contracts";
import type { ScreenPoint } from "../geometry";

interface CatalogMapSelectionControllerOptions {
  selector: CatalogPointSelector;
  hydrationStates: Map<string, ObjectDetailHydrationState>;
  selectedKey: () => string;
  edgeBodyAt: (point: ScreenPoint) => Body | null;
  nearestBodyAt: (point: ScreenPoint) => Body | null;
  nearestCatalogPointAt: (point: ScreenPoint) => CatalogPointHitEntry | null;
  mergeBody: (body: Body) => void;
  removeBody: (key: string) => void;
  selectBody: (key: string, options?: SelectBodyOptions) => void;
  clearSelection: (options: { preserveMapDetailRequest: boolean }) => void;
  inspection: ObjectInspectionView;
  detailError: () => string;
}

export class CatalogMapSelectionController {
  private detailController: AbortController | null = null;
  private transientKeyState: string | null = null;
  private hydrationRequestId = 0;

  constructor(private readonly options: CatalogMapSelectionControllerOptions) {}

  get transientKey(): string | null {
    return this.transientKeyState;
  }

  setTransientKey(key: string | null): void {
    this.transientKeyState = key;
  }

  cancel(): void {
    this.detailController?.abort();
    this.detailController = null;
  }

  cleanupTransient(key: string | null): void {
    if (!key || key !== this.transientKeyState) return;
    this.options.hydrationStates.delete(key);
    this.options.removeBody(key);
    this.transientKeyState = null;
  }

  async handleClick(point: ScreenPoint): Promise<void> {
    this.cancel();
    const edgeBody = this.options.edgeBodyAt(point);
    if (edgeBody) {
      this.options.selectBody(edgeBody.key, { center: true, zoom: "local", animate: true });
      return;
    }

    const nearestBody = this.options.nearestBodyAt(point);
    if (nearestBody) {
      this.options.selectBody(nearestBody.key, { center: true, animate: true });
      return;
    }
    await this.selectCatalogPoint(point);
  }

  private async selectCatalogPoint(point: ScreenPoint): Promise<void> {
    const detailController = new AbortController();
    this.detailController = detailController;
    const nearestQuery = this.options.selector.nearestQuery(point);
    const tileHit = this.options.nearestCatalogPointAt(point);
    const tilePreview = tileHit ? this.options.selector.preview(tileHit) : null;
    if (!tileHit || !tilePreview) {
      const catalogPoint = await this.options.selector.nearest(point, detailController.signal, nearestQuery);
      if (detailController.signal.aborted) return;
      this.release(detailController);
      if (catalogPoint) {
        this.options.mergeBody(catalogPoint);
        this.options.selectBody(catalogPoint.key, { center: true, animate: true });
      }
      return;
    }

    const requestId = ++this.hydrationRequestId;
    this.options.hydrationStates.set(tilePreview.key, { status: "loading", requestId });
    this.options.mergeBody(tilePreview);
    this.options.selectBody(tilePreview.key, { center: true, animate: true, transient: true });

    const catalogPoint = (await this.options.selector.hydrate(tileHit, detailController.signal))
      ?? await this.options.selector.nearestFromApi(nearestQuery, detailController.signal);
    if (detailController.signal.aborted) {
      this.cleanupOwnedPreview(tilePreview.key, requestId);
      return;
    }
    const hydrationState = this.options.hydrationStates.get(tilePreview.key);
    if (this.options.selectedKey() !== tilePreview.key || hydrationState?.requestId !== requestId) {
      if (hydrationState?.requestId === requestId) {
        this.options.hydrationStates.delete(tilePreview.key);
        this.options.removeBody(tilePreview.key);
      }
      this.release(detailController);
      return;
    }
    this.options.hydrationStates.delete(tilePreview.key);
    if (!catalogPoint) {
      this.options.hydrationStates.set(tilePreview.key, {
        status: "error",
        requestId,
        message: this.options.detailError(),
      });
      this.options.inspection.update();
      this.release(detailController);
      return;
    }
    this.options.mergeBody(catalogPoint);
    this.release(detailController);
    this.options.selectBody(catalogPoint.key);
  }

  private cleanupOwnedPreview(key: string, requestId: number): void {
    if (this.options.hydrationStates.get(key)?.requestId !== requestId) return;
    if (this.options.selectedKey() === key) {
      this.options.clearSelection({ preserveMapDetailRequest: true });
      return;
    }
    this.options.hydrationStates.delete(key);
    if (key === this.transientKeyState) this.transientKeyState = null;
    this.options.removeBody(key);
  }

  private release(controller: AbortController): void {
    if (this.detailController === controller) this.detailController = null;
  }
}
