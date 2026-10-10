# Precision instrument model redesign

The v14 instrument's three front modules need distinct readable forms at the
overview scale, credible optical depth in close-ups, and a consistent finish.
The existing layout, cable ports, six project identities and playback remain
the design constraints.

Three directions were considered:

| Direction | Visual value | Decision |
| --- | --- | --- |
| More rings and microdetail | More surface density; same weak silhouettes | Rejected |
| Organic sculptures and liquid metal | Strong individual objects; weak connection to the existing instrument | Rejected |
| Precision cells with exposed internals | Clear mechanical hierarchy, restrained optics, readable vessel | Selected |

GEO is a seated cable cartridge. A six-window cage meets both spoke endplates
at their mounting faces. Bored service sleeves fit the center seats. The front
graphite bushing sits inside the endplate; the central winding envelope stays
open. Unsupported vanes, invented bearing races and the floating flange were
removed. This is a mechanically readable enclosure, not a working turbine.

LIGHT becomes two seated biconvex lenses, each with its own optical mesh, in
black cells with turned silver lips and three collimation tie rods. A restrained
antireflection coating replaces the broad rainbow response. Lens depth comes
from actual closed native CAD surfaces.

ELEMENTS gains two rounded protective frames, four corner tie rods and socket
hardware. Its exact original glass vessel, water volume, gaskets, curved jacket
and FLIP/combustion caches are retained, so animated matter still fits its
container. Mild glass attenuation and a softer surface reflection help reveal
the vessel against the paper background.

All new forms are authored CAD geometry. No beauty-image projection or
generated material images are introduced. Raw CAD, mesh integrity results and
browser evidence stay in the local model-redesign evidence directory. This is
a portfolio sculpture, with no manufacturing or pressure-rating claim.

Startup revision: desktop now uses the same verified complete GEO prefix as
mobile (478,907 compressed bytes). Full mesh transfer is 33,187,786 bytes.
Textures decode off the document thread, with original TextureLoader fallback.
Exact HDR shader passes prepare asynchronously; unused default-framebuffer
variants are skipped, and identical opaque shaders share program keys across
modules. The gateway gives matching geometry SHA fingerprints a one-year
immutable cache, while stale fingerprints and page source still revalidate.
