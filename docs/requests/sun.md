# Requests from the sun module (living Sun)

There are no contract changes. Each item below is shimmed inside `src/modules/sun/`.

1. **A hook for adding to another module's info card.** The Sun's card comes from the `solar-system` info
   provider. To label the simulated activity (sunspot number of the simulated cycle, group count, "simulated,
   not real positions", the solar filter state), `src/modules/sun/index.ts` wraps that provider's `info` in
   place at init, keeping the provider order. It is guarded (it does nothing if the provider is missing), but it
   silently stops working if solar-system re-registers through `registry.addInfo` (which replaces by id) or if
   the registry starts returning copies or frozen providers. Re-registering the `solar-system` id from the sun
   module is not a clean alternative, because it changes the provider order.
   Suggested hook: `registry.addInfoDecorator(id, (card, targetId) => card)` (or an optional
   `InfoProvider.decorate?(card, id)`) applied in `UiController.resolveInfo` after the provider answers. The
   sun module would switch to it and drop the wrapper.
2. **A perf budget for a Sun close-up.** The owner's target is 60 fps on the medium preset for Sun close-ups
   (MacBook Pro M4 Pro). Only SwiftShader e2e runs exist. Suggested: a `sun-sunspots` entry in
   `tests/e2e/perf.spec.ts` budgets (the bookmark draws the photosphere with spots, pores and faculae over the
   whole frame), and a manual fps check on the target machine.
