# UIH visual quality and fidelity

Evaluate quality and fidelity independently. Never improve an implementation by silently changing its approved reference.

Review in this order: page geometry and hierarchy; typography and wrapping; alignment and spacing; assets and colors; borders, shadows, radii and fine details.

Give concrete findings with component/location and observable evidence. Quantify distances only when the images support it. Do not invent exact font names from pixels.

Preserve real controls, accessibility labels, navigation, loading/error states, and existing handlers. Never replace functional UI with an image of the mockup. Use existing licensed assets and available fonts.

For mobile inspect safe areas, system bars, keyboard accommodation, text scaling, and touch targets when the supplied scenario provides evidence. Record untested states as untested, not passing.

For component fixes, preserve parent constraints and sibling alignment. Escalate shared typography/layout problems to the full-screen pass instead of compensating with arbitrary local offsets.
