# More of Neru's poses

Cut out of her song's music video with `tools/neru-art.py` like the ones in `public/`, but not shipped: in each the
video's frame cuts straight down her hair or her side, and even faded (`tools/neru-polish.py`) it still reads as a
line. To use one anyway, move it into `public/`, give it a screen in `NeruCameo.POSE` (or an easter egg in `NeruEggs`)
and its head size in `NeruCameo.HEAD`:

| pose | head size |
|---|---|
| meh | 0.52 |
| pointat | 0.32 |
| side | 0.37 |
| smirk | 0.53 |

Every picture in `public/` that runs off a side of its frame has been through `tools/neru-polish.py` (a longer, eased
fade there than `neru-art.py` gives a side); a new one should be too.
