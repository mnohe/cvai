Jinja2 templates for server-rendered CVAI pages live here. Full pages extend
`base.html.j2`; small interactive regions use partial templates that can be
returned directly to HTMX requests.

Route handlers configure this directory through `fastapi.templating.Jinja2Templates`.
