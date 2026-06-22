/**
 * Dispersal Draft — Draft module sub-tab entry point.
 *
 * Hosts the ported standalone app's multi-"page" flow (home → create →
 * :code/setup → :code) inside a single tab, using the feature-local router
 * shim (state persisted to the page URL's `?dd=` query param). Real-time
 * updates flow over Socket.io (/api/ws).
 */
import { DispersalRouterProvider, useDispersalView } from "@dispersal/router";
import Home from "@dispersal/pages/home";
import Create from "@dispersal/pages/create";
import RoomSetup from "@dispersal/pages/room-setup";
import Room from "@dispersal/pages/room";

function DispersalOutlet() {
  const view = useDispersalView();
  switch (view.name) {
    case "create": return <Create />;
    case "setup": return <RoomSetup />;
    case "room": return <Room />;
    case "home":
    default: return <Home />;
  }
}

export function DispersalDraft() {
  return (
    <DispersalRouterProvider>
      <DispersalOutlet />
    </DispersalRouterProvider>
  );
}

export default DispersalDraft;
