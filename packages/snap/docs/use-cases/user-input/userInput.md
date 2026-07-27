# Use case: user input (`UserInputHandler`)

Interactive UI events via `onUserInput` → `UserInputHandler`.

| | |
| --- | --- |
| **Entry** | `onUserInput` → `UserInputHandler.handle` |
| **Source** | [`handlers/user-input/userInput.ts`](../../../src/handlers/user-input/userInput.ts) |

## Participants

| Component | Path | Role |
| --- | --- | --- |
| `UserInputHandler` | `handlers/user-input` | Route UI events by `event.name` |
| Confirmation view events | `ui/confirmation/views/*/events` | Confirm / cancel (and related) handlers that resolve the dialog |

## Request / response

Wire format follows the MetaMask **interactive UI** entry point:

- [Entry points — `onUserInput`](https://docs.metamask.io/snaps/reference/entry-points/#onuserinput)

MetaMask calls `onUserInput` with `{ id, event, context }` when the user interacts with a Snap interface. This Snap ignores events without a `name`, then dispatches to a handler map built from confirmation views.

## Methods

| Method | What it does | Data source |
| --- | --- | --- |
| `onUserInput` | Route named UI events to confirmation handlers (sign message / tx / auth entry, change trust, send, malicious acknowledgement) | |
