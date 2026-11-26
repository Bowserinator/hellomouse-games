# Rules for new games

## Scope and Git

- Do not add to `docs/`, edit `README.md`, or write other documentation unless asked.
- Never run `gitr allow tests/` or add tests to Git.
- Do not add unnecessary labels or descriptions. Use only the minimum required text.
- Never edit anything in `build/` -- it is auto-generated

## Game interface

- Make text unselectable within the game only, unless specified otherwise. Keep invite links selectable.
- Provide a copy invite box that contains the invite link. Clicking the link field must select the full link. Include a copy link button.
- Use the same social meta tags as the existing games.
- Use a line height around `1.1` or `1.2`, unless asked otherwise.
- Do not use rounded corners, except on playing cards, unless asked otherwise.

## Code and styles

- Never edit `.css` files. Edit `.scss` files instead.
- Prefer to keep each game's server-side code in one file.
- Use proper formatting and four-space indentation in JavaScript and stylesheets.
- Keep comments minimal.
- Avoid long comments with implementation-specific or coupled details. Abstract-class comments must not list implementations or expose their details.
- Module comments should summarize the module, not list its functions or classes.
- Do not add obvious comments to short functions or beside self-explanatory code. Add a comment only when the reason is not clear from the code.
- Comments should describe what the code does, not its storage format or implementation details. Do not expose representation details or name internal helpers unnecessarily.
- Never add steps to build/ or new npm commands to validate etc... unless explicitly asked
- Never log anything on server side unless asked