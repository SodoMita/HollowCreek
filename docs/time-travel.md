# Timepiece: command-replay implementation

(See [notes.md](./notes.md) for pinned pages on walls/trees — they travel through time with the world.)

A living, uncaged player can find a timepiece on the road, pick it up with **E**, and press **M** (or the HUD button) to choose a recorded moment. Confirming consumes that item. A visit lasts at most 60 seconds; **M** returns early, and a meeting, the end of the night, leaving, or a lost connection also returns the traveler. After the first two pieces are spent, another single-use timepiece appears, so a later traveler can change an earlier traveler's present. Only one visit is active at a time.

## Many timepieces, and time travel in time travel

A night can carry several timepieces at once (they rest at x=1260 and beyond, spaced apart); each is an individually tracked, single-use item — picking one up, carrying it, or spending it never affects the others. While traveling in the past, a visitor can also pick up a timepiece that lies loose in that moment and use it there: **M** in the shadow opens the same moment picker, restricted to recorded moments at or before the current past cursor. Using a piece inside the past re-bases the whole visit at that earlier recorded frame — every action the visitor already took in the past replays forward from the deeper moment — and the piece is spent. This nests: a visitor holding several pieces can travel deeper again and again, each hop consuming one piece. The visit itself stays the causal anchor, and on return the deepest reconciled past is written back into the present. Later travelers whose windows overlap an earlier visit see that visitor's echo, so several souls can meet each other across time in one night.

## How the replay works

The server records an ordered journal of player inputs, server ticks, connection-presence events, departures, and returns. Periodic checkpoints bound the work needed to reconstruct a selected moment. Puzzle randomness and repair-kit identities are derived from the recorded event seed and ID, and the same logical clock is used during replay. Replaying does not write duplicate chronicle or lifetime-stat events.

The traveler is inserted as a separate incarnation at the chosen moment. Other people repeat their recorded inputs against the changed state: a pickup can fail because an item was taken earlier, a door can remain locked, movement can stay outside, a repair can fail, a vote can have a different result, or a strike can hit a different person. The server replays the remaining commands forward and reconciles the resulting world and player states into the present. Completed visits and their inserted commands are retained, so a later visit can also affect someone who previously traveled and returned. Recorded people are not AI agents: they repeat inputs rather than choosing new ones.

Visible nearby players and echoes show a pickup notice and carry the corresponding item icon. Historical speech and witnessed actions are visible within normal vision; roles are not exposed by the replay. Voice chat is isolated between the present and an active past visit.

Keys and dropped repair kits have unique identities. A time traveler can carry them back; subsequent recorded attempts to use a missing item are evaluated against the changed world. The supply cart has unlimited stock, so a kit newly taken from the cart is a distinct kit. Items held before entering a visit are left at the departure point in the present. Either role can repair in the past; Hollow players can also sabotage and strike.

A timepiece activation is a causal anchor: even if later edits would have prevented its original pickup, the already-created visit remains in the timeline. A replayed death or caging can still force the traveler back and affect their present self. Chronicle entries remain an audit of originally received actions and temporal rewrites. The active match, checkpoints, command journal, and revisions live in the running room; a server restart ends the interrupted night, matching existing room behavior. The single-player school provides a simplified practice version; multiplayer uses the authoritative command replay.
