import type { Page } from '@playwright/test';

export async function mockGoogleMaps(page: Page) {
  await page.addInitScript(() => {
    class FakeEventTarget {
      listeners: Record<string, Array<(event?: unknown) => void>> = {};

      addListener(name: string, listener: (event?: unknown) => void) {
        this.listeners[name] = [...(this.listeners[name] ?? []), listener];
        if (name === 'idle') queueMicrotask(() => listener());
        return { remove: () => { this.listeners[name] = (this.listeners[name] ?? []).filter((item) => item !== listener); } };
      }

      emit(name: string, event?: unknown) {
        for (const listener of this.listeners[name] ?? []) listener(event);
      }
    }

    class FakePath extends FakeEventTarget {
      points: Array<{ lat: number; lng: number }>;

      constructor(points: Array<{ lat: number; lng: number }> = []) {
        super();
        this.points = points;
      }

      getLength() { return this.points.length; }
      getAt(index: number) {
        const point = this.points[index];
        return { lat: () => point.lat, lng: () => point.lng };
      }
    }

    class FakeOverlay extends FakeEventTarget {
      options: Record<string, any>;
      active = true;

      constructor(options: Record<string, any> = {}) {
        super();
        this.options = options;
      }

      setMap(map: unknown) {
        this.options.map = map;
        this.active = Boolean(map);
      }

      setPosition(position: unknown) {
        this.options.position = position;
      }

      getPath() {
        return new FakePath(this.options.path ?? this.options.paths ?? []);
      }
    }

    class FakeMap extends FakeEventTarget {
      element: HTMLElement;
      options: Record<string, any>;
      zoom: number;

      constructor(element: HTMLElement, options: Record<string, any>) {
        super();
        this.element = element;
        this.options = options;
        this.zoom = options.zoom ?? 17;
        element.dataset.fakeGoogleMap = 'true';
      }

      fitBounds() {}
      panTo() {}
      setZoom(zoom: number) { this.zoom = zoom; }
      getZoom() { return this.zoom; }
      setOptions(options: Record<string, any>) { this.options = { ...this.options, ...options }; }
    }

    class FakeMarker extends FakeOverlay {
      constructor(options: Record<string, any>) {
        super(options);
        (window as any).__growupMapMarkers.push(this);
      }
    }

    class FakeCircle extends FakeOverlay {
      constructor(options: Record<string, any>) {
        super(options);
        (window as any).__growupMapCircles.push(this);
      }
    }
    class FakePolygon extends FakeOverlay {
      constructor(options: Record<string, any>) {
        super(options);
        (window as any).__growupMapPolygons.push(this);
      }
    }
    class FakePolyline extends FakeOverlay {
      constructor(options: Record<string, any>) {
        super(options);
        (window as any).__growupMapPolylines.push(this);
      }
    }
    class FakeGroundOverlay extends FakeOverlay {
      constructor(bounds: unknown, url: string, options: Record<string, any>) {
        super({ ...options, bounds, url });
      }
    }

    class FakeLatLngBounds {
      points: unknown[] = [];
      constructor(southWest?: unknown, northEast?: unknown) {
        if (southWest) this.points.push(southWest);
        if (northEast) this.points.push(northEast);
      }
      extend(point: unknown) { this.points.push(point); }
      isEmpty() { return this.points.length === 0; }
    }

    (window as any).__growupMapMarkers = [];
    (window as any).__growupMapCircles = [];
    (window as any).__growupMapPolygons = [];
    (window as any).__growupMapPolylines = [];
    (window as any).google = {
      maps: {
        Map: FakeMap,
        Marker: FakeMarker,
        Circle: FakeCircle,
        Polygon: FakePolygon,
        Polyline: FakePolyline,
        GroundOverlay: FakeGroundOverlay,
        LatLngBounds: FakeLatLngBounds,
        SymbolPath: { CIRCLE: 'circle', FORWARD_CLOSED_ARROW: 'forward-closed-arrow' },
      },
    };
  });
}
