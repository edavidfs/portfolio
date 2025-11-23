# ng-portfolio (Angular)

Port de la app a Angular con estructura por componentes y un servicio de datos que gestiona importación CSV, FX, agregaciones y persistencia con SQL.js.

## Desarrollo

1. Requisitos: Node 18+, npm.
2. Instalar deps: `npm install` dentro de `frontend/`.
3. Arrancar web: `npm start` y abrir `http://localhost:4200/`.
4. Envolver como escritorio: `npm run tauri -- dev` para levantar Tauri (requiere que `ng serve` esté corriendo).

## Notas

- Chart.js, Papa Parse y SQL.js se cargan por CDN en `src/index.html`.
- La persistencia usa `localStorage` (`portfolioDB`).
- Los traspasos FX (símbolos `BASE.QUOTE`) generan dos movimientos de caja con comisión aplicada en su divisa.
