document.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('stage');
    const tools = document.querySelectorAll('.tool');
    const saveBtn = document.getElementById('saveBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadInput = document.getElementById('uploadInput');
    const exportSvgBtn = document.getElementById('exportSvgBtn');
    const exportHtmlBtn = document.getElementById('exportHtmlBtn');
    const exportSqlBtn = document.getElementById('exportSqlBtn');
    const exportPyBtn = document.getElementById('exportPyBtn');
    const clearBtn = document.getElementById('clearBtn');

    // Contenedor interno para poder aplicar transform (pan/zoom)
    const stageInner = document.createElement('div');
    stageInner.classList.add('stage-inner');
    stage.appendChild(stageInner);

    let modoFlechaActivo = false;
    let tipoFlecha = 'simple';        // 'simple' | 'doble'
    let estiloConexion = 'straight';  // 'straight' | 'ortho'
    let nodoInicioSeleccionado = null; // puede ser forma o puerto
    let nodoFinSeleccionado = null;
    let flechas = [];
    let contadorFormas = 0;
    let contadorPropiedades = 0;

    // Pan / zoom del lienzo
    let stageScale = 1;
    let stageOffsetX = 0;
    let stageOffsetY = 0;
    const stageMinScale = 0.2;
    const stageMaxScale = 3;

    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartOffsetX = 0;
    let panStartOffsetY = 0;

    // Selección para borrado
    let elementoSeleccionado = null;

    const EXPORT_PADDING = 40;
    const LS_KEY = 'jocarsa_dia_autosave_v1';

    /* ===== Transform del stage ===== */

    function updateStageTransform() {
        stageInner.style.transform =
            `translate(${stageOffsetX}px, ${stageOffsetY}px) scale(${stageScale})`;
    }

    function generarIdForma() {
        return `forma-${++contadorFormas}`;
    }

    function generarIdPropiedad() {
        return `prop-${++contadorPropiedades}`;
    }

    /* ===== Helpers de coordenadas ===== */

    function worldRect(el) {
        const rect = el.getBoundingClientRect();
        const rectStage = stage.getBoundingClientRect();
        const sx = rect.left - rectStage.left;
        const sy = rect.top - rectStage.top;
        const x = (sx - stageOffsetX) / stageScale;
        const y = (sy - stageOffsetY) / stageScale;
        const width = rect.width / stageScale;
        const height = rect.height / stageScale;
        return { x, y, width, height };
    }

    function puntoEnBorde(cx, cy, rectWidth, rectHeight, tx, ty) {
        const dx = tx - cx;
        const dy = ty - cy;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDx === 0 && absDy === 0) {
            return { x: cx, y: cy };
        }

        const halfW = rectWidth / 2;
        const halfH = rectHeight / 2;

        const scale = 1 / Math.max(absDx / halfW, absDy / halfH);
        return {
            x: cx + dx * scale,
            y: cy + dy * scale
        };
    }

    function getConnectionPoints(formaInicio, formaFin) {
        const rectInicio = formaInicio.getBoundingClientRect();
        const rectFin = formaFin.getBoundingClientRect();
        const rectStage = stage.getBoundingClientRect();

        const centroInicioScreenX = rectInicio.left + rectInicio.width / 2 - rectStage.left;
        const centroInicioScreenY = rectInicio.top + rectInicio.height / 2 - rectStage.top;
        const centroFinScreenX = rectFin.left + rectFin.width / 2 - rectStage.left;
        const centroFinScreenY = rectFin.top + rectFin.height / 2 - rectStage.top;

        const centroInicioX = (centroInicioScreenX - stageOffsetX) / stageScale;
        const centroInicioY = (centroInicioScreenY - stageOffsetY) / stageScale;
        const centroFinX = (centroFinScreenX - stageOffsetX) / stageScale;
        const centroFinY = (centroFinScreenY - stageOffsetY) / stageScale;

        const anchoInicio = rectInicio.width / stageScale;
        const altoInicio = rectInicio.height / stageScale;
        const anchoFin = rectFin.width / stageScale;
        const altoFin = rectFin.height / stageScale;

        const bordeInicio = puntoEnBorde(
            centroInicioX,
            centroInicioY,
            anchoInicio,
            altoInicio,
            centroFinX,
            centroFinY
        );

        const bordeFin = puntoEnBorde(
            centroFinX,
            centroFinY,
            anchoFin,
            altoFin,
            centroInicioX,
            centroInicioY
        );

        return {
            startX: bordeInicio.x,
            startY: bordeInicio.y,
            endX: bordeFin.x,
            endY: bordeFin.y
        };
    }

    /* ===== Serialización / LocalStorage ===== */

    function exportDiagramAsJSON() {
        const formas = [];
        stageInner.querySelectorAll('.shape').forEach(el => {
            const tipo = Array.from(el.classList)
                .find(cls => ['rectangle', 'pill', 'circle', 'db', 'entity', 'text'].includes(cls));

            const forma = {
                id: el.id,
                tipo,
                left: el.style.left,
                top: el.style.top,
                width: el.style.width,
                height: el.style.height
            };

            if (tipo === 'entity') {
                const header = el.querySelector('.entity-header');
                forma.entityName = header ? header.textContent : '';
                forma.properties = [];
                el.querySelectorAll('.entity-property').forEach(propEl => {
                    const nameEl = propEl.querySelector('.property-name');
                    forma.properties.push({
                        id: propEl.dataset.propId,
                        name: nameEl ? nameEl.textContent : ''
                    });
                });
            } else {
                forma.texto = el.textContent;
            }

            formas.push(forma);
        });

        const datosFlechas = flechas.map(f => {
            const fromNode = f.formaInicio;
            const toNode = f.formaFin;

            const fromShape = f.shapeInicio;
            const toShape = f.shapeFin;

            const fromProp = fromNode.closest('.entity-property');
            const toProp = toNode.closest('.entity-property');

            const fromSide = fromNode.classList.contains('port-left')
                ? 'left'
                : fromNode.classList.contains('port-right')
                    ? 'right'
                    : null;

            const toSide = toNode.classList.contains('port-left')
                ? 'left'
                : toNode.classList.contains('port-right')
                    ? 'right'
                    : null;

            return {
                desde: {
                    shapeId: fromShape.id,
                    propId: fromProp ? fromProp.dataset.propId : null,
                    side: fromSide
                },
                hasta: {
                    shapeId: toShape.id,
                    propId: toProp ? toProp.dataset.propId : null,
                    side: toSide
                },
                tipo: f.tipo || 'simple',
                estilo: f.estilo || 'straight'
            };
        });

        return JSON.stringify({ formas, flechas: datosFlechas }, null, 2);
    }

    function saveToLocalStorage() {
        try {
            const json = exportDiagramAsJSON();
            localStorage.setItem(LS_KEY, json);
        } catch (e) {
            console.warn('No se pudo guardar en localStorage', e);
        }
    }

    function loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem(LS_KEY);
            if (!saved) return null;
            return JSON.parse(saved);
        } catch (e) {
            console.warn('No se pudo cargar desde localStorage', e);
            return null;
        }
    }

    function rebuildFromData(data) {
        const formas = data.formas || [];
        const datosFlechas = data.flechas || [];

        stageInner.innerHTML = '';
        flechas = [];
        contadorFormas = 0;
        contadorPropiedades = 0;
        elementoSeleccionado = null;
        nodoInicioSeleccionado = null;
        nodoFinSeleccionado = null;

        const mapaFormas = {};

        // Crear formas
        formas.forEach(forma => {
            let el;

            if (forma.tipo === 'entity') {
                el = document.createElement('div');
                el.id = forma.id || generarIdForma();
                el.classList.add('shape', 'entity');
                el.style.left = forma.left;
                el.style.top = forma.top;
                if (forma.width) el.style.width = forma.width;
                if (forma.height) el.style.height = forma.height;

                el.innerHTML = `
                    <div class="entity-header" contenteditable="true"></div>
                    <div class="entity-properties"></div>
                    <button type="button" class="entity-add-prop">+ atributo</button>
                `;

                const header = el.querySelector('.entity-header');
                header.textContent = forma.entityName || 'Entidad';

                const propsContainer = el.querySelector('.entity-properties');

                (forma.properties || []).forEach(prop => {
                    crearPropiedad(propsContainer, prop.name || 'atributo', prop.id || null);

                    if (prop.id) {
                        const m = prop.id.match(/prop-(\d+)/);
                        if (m) {
                            const n = parseInt(m[1], 10);
                            if (!isNaN(n) && n > contadorPropiedades) {
                                contadorPropiedades = n;
                            }
                        }
                    }
                });

                stageInner.appendChild(el);
                hacerArrastrable(el);
                inicializarEntidad(el, { addDefaultProperty: false });
            } else {
                el = document.createElement('div');
                el.id = forma.id || generarIdForma();
                el.classList.add('shape', forma.tipo);
                el.style.left = forma.left;
                el.style.top = forma.top;
                if (forma.width) el.style.width = forma.width;
                if (forma.height) el.style.height = forma.height;
                el.textContent = forma.texto || '';
                stageInner.appendChild(el);
                hacerArrastrable(el);
                prepararEdicionTexto(el);
            }

            if (el.id) {
                const match = el.id.match(/forma-(\d+)/);
                if (match) {
                    const n = parseInt(match[1], 10);
                    if (!isNaN(n) && n > contadorFormas) contadorFormas = n;
                }
            }

            mapaFormas[el.id] = el;
        });

        // Mapa de puertos por propId+lado
        const mapaPuertos = {};
        stageInner.querySelectorAll('.entity-property').forEach(propEl => {
            const propId = propEl.dataset.propId;
            if (!propId) return;
            const leftPort = propEl.querySelector('.port-left');
            const rightPort = propEl.querySelector('.port-right');
            if (leftPort) mapaPuertos[`${propId}:left`] = leftPort;
            if (rightPort) mapaPuertos[`${propId}:right`] = rightPort;
        });

        // Crear flechas
        if (Array.isArray(datosFlechas)) {
            datosFlechas.forEach(df => {
                const tipo = df.tipo || 'simple';
                const estilo = df.estilo || 'straight';

                if (df.desde && df.hasta) {
                    let fromNode = null;
                    let toNode = null;

                    const fromShape = mapaFormas[df.desde.shapeId];
                    const toShape = mapaFormas[df.hasta.shapeId];

                    if (df.desde.propId && df.desde.side) {
                        fromNode = mapaPuertos[`${df.desde.propId}:${df.desde.side}`];
                    }
                    if (!fromNode) fromNode = fromShape;

                    if (df.hasta.propId && df.hasta.side) {
                        toNode = mapaPuertos[`${df.hasta.propId}:${df.hasta.side}`];
                    }
                    if (!toNode) toNode = toShape;

                    if (fromNode && toNode) {
                        crearFlecha(fromNode, toNode, tipo, estilo);
                    }
                } else if (df.idInicio && df.idFin) {
                    // compat con formato antiguo
                    const formaInicio = mapaFormas[df.idInicio];
                    const formaFin = mapaFormas[df.idFin];
                    if (formaInicio && formaFin) {
                        crearFlecha(formaInicio, formaFin, tipo, 'straight');
                    }
                }
            });
        }

        stageScale = 1;
        stageOffsetX = 0;
        stageOffsetY = 0;
        updateStageTransform();
    }

    function clearStage() {
        stageInner.innerHTML = '';
        flechas = [];
        contadorFormas = 0;
        contadorPropiedades = 0;
        elementoSeleccionado = null;
        nodoInicioSeleccionado = null;
        nodoFinSeleccionado = null;

        stageScale = 1;
        stageOffsetX = 0;
        stageOffsetY = 0;
        updateStageTransform();

        try {
            localStorage.removeItem(LS_KEY);
        } catch (e) {
            console.warn('No se pudo limpiar localStorage', e);
        }
    }

    /* ===== Herramientas ===== */

    tools.forEach(tool => {
        // Arrastre de formas desde la barra
        tool.addEventListener('dragstart', (e) => {
            const shape = tool.dataset.shape;
            if (['rectangle', 'pill', 'circle', 'db', 'entity', 'text'].includes(shape)) {
                e.dataTransfer.setData('shape', shape);
            }
        });

        // Clic en herramienta
        tool.addEventListener('click', () => {
            tools.forEach(t => t.classList.remove('active'));
            const shapeType = tool.dataset.shape;

            const esConexion = [
                'arrow',
                'bidirectional',
                'ortho',
                'ortho-bidirectional'
            ].includes(shapeType);

            if (esConexion) {
                modoFlechaActivo = true;
                tipoFlecha = (shapeType === 'bidirectional' || shapeType === 'ortho-bidirectional')
                    ? 'doble'
                    : 'simple';
                estiloConexion = (shapeType === 'ortho' || shapeType === 'ortho-bidirectional')
                    ? 'ortho'
                    : 'straight';

                stage.style.cursor = 'crosshair';
                tool.classList.add('active');

                nodoInicioSeleccionado = null;
                nodoFinSeleccionado = null;
                document.querySelectorAll('.shape, .port').forEach(forma => {
                    forma.classList.remove('selected');
                });
            } else {
                modoFlechaActivo = false;
                stage.style.cursor = 'grab';
            }
        });
    });

    /* ===== Selección de formas / puertos y flechas + conexión ===== */

    stage.addEventListener('click', (e) => {
        const portClicado = e.target.closest('.port');
        const formaClicada = e.target.closest('.shape');
        const flechaClicada = e.target.closest('.arrow, .ortho-arrow');

        if (modoFlechaActivo) {
            const nodoClicado = portClicado || formaClicada;
            if (!nodoClicado) return;

            if (!nodoInicioSeleccionado) {
                nodoInicioSeleccionado = nodoClicado;
                nodoClicado.classList.add('selected');
            } else if (!nodoFinSeleccionado && nodoClicado !== nodoInicioSeleccionado) {
                nodoFinSeleccionado = nodoClicado;
                nodoClicado.classList.add('selected');

                crearFlecha(
                    nodoInicioSeleccionado,
                    nodoFinSeleccionado,
                    tipoFlecha,
                    estiloConexion
                );

                nodoInicioSeleccionado.classList.remove('selected');
                nodoFinSeleccionado.classList.remove('selected');
                nodoInicioSeleccionado = null;
                nodoFinSeleccionado = null;

                modoFlechaActivo = false;
                stage.style.cursor = 'grab';
                tools.forEach(t => t.classList.remove('active'));
            }
            return;
        }

        limpiarSeleccion();
        if (formaClicada) {
            elementoSeleccionado = formaClicada;
            formaClicada.classList.add('selected');
        } else if (flechaClicada) {
            elementoSeleccionado = flechaClicada;
            flechaClicada.classList.add('selected');
        } else {
            elementoSeleccionado = null;
        }
    });

    function limpiarSeleccion() {
        document
            .querySelectorAll('.shape.selected, .arrow.selected, .ortho-arrow.selected, .port.selected')
            .forEach(el => el.classList.remove('selected'));
    }

    /* ===== Creación y actualización de flechas ===== */

    function crearFlecha(nodoInicio, nodoFin, tipo = 'simple', estilo = 'straight') {
        let flecha;

        if (estilo === 'straight') {
            flecha = document.createElement('div');
            flecha.classList.add('arrow');
            if (tipo === 'doble') {
                flecha.classList.add('arrow-double');
            }
        } else {
            flecha = document.createElement('div');
            flecha.classList.add('ortho-arrow');
            if (tipo === 'doble') {
                flecha.classList.add('ortho-arrow-double');
            }

            const seg1 = document.createElement('div');
            seg1.classList.add('ortho-seg', 'seg-horizontal', 'seg1');

            const seg2 = document.createElement('div');
            seg2.classList.add('ortho-seg', 'seg-vertical', 'seg2');

            const headEnd = document.createElement('div');
            headEnd.classList.add('ortho-arrowhead', 'ortho-head-end');

            flecha.appendChild(seg1);
            flecha.appendChild(seg2);
            flecha.appendChild(headEnd);

            if (tipo === 'doble') {
                const headStart = document.createElement('div');
                headStart.classList.add('ortho-arrowhead', 'ortho-head-start');
                flecha.appendChild(headStart);
            }
        }

        stageInner.appendChild(flecha);

        const shapeInicio = nodoInicio.closest('.shape') || nodoInicio;
        const shapeFin = nodoFin.closest('.shape') || nodoFin;

        const objFlecha = {
            flecha,
            formaInicio: nodoInicio,
            formaFin: nodoFin,
            shapeInicio,
            shapeFin,
            tipo,
            estilo,
            manejadorMovimiento: null
        };

        const manejadorMovimiento = () => actualizarPosicionFlecha(objFlecha);
        objFlecha.manejadorMovimiento = manejadorMovimiento;
        flechas.push(objFlecha);

        shapeInicio.manejadoresMovimiento = shapeInicio.manejadoresMovimiento || [];
        shapeFin.manejadoresMovimiento = shapeFin.manejadoresMovimiento || [];
        shapeInicio.manejadoresMovimiento.push(manejadorMovimiento);
        shapeFin.manejadoresMovimiento.push(manejadorMovimiento);

        actualizarPosicionFlecha(objFlecha);
        saveToLocalStorage();
    }

    function actualizarPosicionFlecha(obj) {
        const { flecha, formaInicio, formaFin, estilo, tipo } = obj;

        const pts = getConnectionPoints(formaInicio, formaFin);
        const dx = pts.endX - pts.startX;
        const dy = pts.endY - pts.startY;
        const longitud = Math.sqrt(dx * dx + dy * dy);

        if (longitud === 0) {
            if (flecha.classList.contains('arrow')) {
                flecha.style.width = '0px';
            }
            return;
        }

        if (estilo === 'straight') {
            const angulo = Math.atan2(dy, dx);
            flecha.style.left = `${pts.startX}px`;
            flecha.style.top = `${pts.startY}px`;
            flecha.style.width = `${longitud}px`;
            flecha.style.transform = `rotate(${angulo}rad)`;
        } else {
            const elbowX = pts.endX;
            const elbowY = pts.startY;

            const seg1 = flecha.querySelector('.seg1');
            const seg2 = flecha.querySelector('.seg2');
            const headEnd = flecha.querySelector('.ortho-head-end');
            const headStart = flecha.querySelector('.ortho-head-start');

            if (!seg1 || !seg2 || !headEnd) return;

            const seg1Left = Math.min(pts.startX, elbowX);
            const seg1Width = Math.abs(elbowX - pts.startX);

            seg1.style.left = `${seg1Left}px`;
            seg1.style.top = `${elbowY}px`;
            seg1.style.width = `${seg1Width}px`;
            seg1.style.height = `2px`;

            const seg2Top = Math.min(elbowY, pts.endY);
            const seg2Height = Math.abs(pts.endY - elbowY);

            seg2.style.left = `${elbowX}px`;
            seg2.style.top = `${seg2Top}px`;
            seg2.style.width = `2px`;
            seg2.style.height = `${seg2Height}px`;

            ['dir-right', 'dir-left', 'dir-up', 'dir-down'].forEach(cls => {
                headEnd.classList.remove(cls);
                if (headStart) headStart.classList.remove(cls);
            });

            if (Math.abs(dy) >= Math.abs(dx)) {
                if (pts.endY >= elbowY) {
                    headEnd.classList.add('dir-down');
                    headEnd.style.left = `${pts.endX - 4}px`;
                    headEnd.style.top = `${pts.endY}px`;
                } else {
                    headEnd.classList.add('dir-up');
                    headEnd.style.left = `${pts.endX - 4}px`;
                    headEnd.style.top = `${pts.endY - 8}px`;
                }
            } else {
                if (pts.endX >= pts.startX) {
                    headEnd.classList.add('dir-right');
                    headEnd.style.left = `${pts.endX}px`;
                    headEnd.style.top = `${pts.endY - 4}px`;
                } else {
                    headEnd.classList.add('dir-left');
                    headEnd.style.left = `${pts.endX - 8}px`;
                    headEnd.style.top = `${pts.endY - 4}px`;
                }
            }

            if (tipo === 'doble' && headStart) {
                if (Math.abs(dx) >= Math.abs(dy)) {
                    if (pts.startX <= elbowX) {
                        headStart.classList.add('dir-left');
                        headStart.style.left = `${pts.startX - 8}px`;
                        headStart.style.top = `${pts.startY - 4}px`;
                    } else {
                        headStart.classList.add('dir-right');
                        headStart.style.left = `${pts.startX}px`;
                        headStart.style.top = `${pts.startY - 4}px`;
                    }
                } else {
                    if (pts.startY <= pts.endY) {
                        headStart.classList.add('dir-up');
                        headStart.style.left = `${pts.startX - 4}px`;
                        headStart.style.top = `${pts.startY - 8}px`;
                    } else {
                        headStart.classList.add('dir-down');
                        headStart.style.left = `${pts.startX - 4}px`;
                        headStart.style.top = `${pts.startY}px`;
                    }
                }
            }
        }
    }

    /* ===== Lienzo: soltar formas ===== */

    stage.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    stage.addEventListener('drop', (e) => {
        e.preventDefault();
        if (modoFlechaActivo) return;

        const tipoForma = e.dataTransfer.getData('shape');
        if (!tipoForma) return;

        const rectStage = stage.getBoundingClientRect();
        const sx = e.clientX - rectStage.left;
        const sy = e.clientY - rectStage.top;

        const worldX = (sx - stageOffsetX) / stageScale;
        const worldY = (sy - stageOffsetY) / stageScale;

        if (tipoForma === 'entity') {
            crearEntidadEn(worldX, worldY);
        } else {
            crearFormaSimple(tipoForma, worldX, worldY);
        }
    });

    function crearFormaSimple(tipoForma, worldX, worldY) {
        const forma = document.createElement('div');
        forma.id = generarIdForma();
        forma.classList.add('shape', tipoForma);

        forma.style.left = `${worldX - 70}px`;
        forma.style.top = `${worldY - 35}px`;
        forma.contentEditable = 'false';
        if (tipoForma === 'db') {
            forma.textContent = 'Base de datos';
        } else if (tipoForma === 'text') {
            forma.textContent = 'Texto';
        } else {
            forma.textContent = '';
        }

        stageInner.appendChild(forma);
        hacerArrastrable(forma);
        prepararEdicionTexto(forma);
        saveToLocalStorage();
    }

    function crearEntidadEn(worldX, worldY) {
        const entidad = document.createElement('div');
        entidad.id = generarIdForma();
        entidad.classList.add('shape', 'entity');
        entidad.style.left = `${worldX - 110}px`;
        entidad.style.top = `${worldX - 50}px`;

        entidad.innerHTML = `
            <div class="entity-header" contenteditable="true">Entidad</div>
            <div class="entity-properties"></div>
            <button type="button" class="entity-add-prop">+ atributo</button>
        `;

        stageInner.appendChild(entidad);
        hacerArrastrable(entidad);
        inicializarEntidad(entidad, { addDefaultProperty: true });
        saveToLocalStorage();
    }

    function inicializarEntidad(entidadEl, options = { addDefaultProperty: false }) {
        const propsContainer = entidadEl.querySelector('.entity-properties');
        const addBtn = entidadEl.querySelector('.entity-add-prop');
        const header = entidadEl.querySelector('.entity-header');

        if (options.addDefaultProperty) {
            crearPropiedad(propsContainer, 'id');
        }

        addBtn.addEventListener('click', () => {
            crearPropiedad(propsContainer, 'atributo');
            saveToLocalStorage();
        });

        if (header) {
            header.addEventListener('input', () => {
                saveToLocalStorage();
            });
        }
    }

    function crearPropiedad(contenedor, nombreInicial = 'atributo', propId = null) {
        const propRow = document.createElement('div');
        propRow.classList.add('entity-property');
        propRow.dataset.propId = propId || generarIdPropiedad();

        const portLeft = document.createElement('div');
        portLeft.classList.add('port', 'port-left');

        const nameEl = document.createElement('div');
        nameEl.classList.add('property-name');
        nameEl.textContent = nombreInicial;
        nameEl.contentEditable = 'true';

        const portRight = document.createElement('div');
        portRight.classList.add('port', 'port-right');

        propRow.appendChild(portLeft);
        propRow.appendChild(nameEl);
        propRow.appendChild(portRight);

        contenedor.appendChild(propRow);

        nameEl.addEventListener('input', () => {
            saveToLocalStorage();
        });
        nameEl.addEventListener('blur', () => {
            saveToLocalStorage();
        });

        return propRow;
    }

    function prepararEdicionTexto(forma) {
        forma.addEventListener('dblclick', () => {
            if (!forma.classList.contains('entity')) {
                forma.contentEditable = 'true';
                forma.focus();
            }
        });

        forma.addEventListener('blur', () => {
            if (!forma.classList.contains('entity')) {
                forma.contentEditable = 'false';
                saveToLocalStorage();
            }
        });
    }

    /* ===== Arrastre de formas (ratón) ===== */

    function hacerArrastrable(elemento) {
        let offsetX, offsetY, arrastrando = false;

        elemento.addEventListener('mousedown', (e) => {
            if (e.target === elemento && !modoFlechaActivo) {
                arrastrando = true;
                const rect = elemento.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                elemento.style.cursor = 'grabbing';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!arrastrando) return;
            const rectStage = stage.getBoundingClientRect();
            const sx = e.clientX - rectStage.left;
            const sy = e.clientY - rectStage.top;

            const worldX = ((sx - stageOffsetX) / stageScale) - (offsetX / stageScale);
            const worldY = ((sy - stageOffsetY) / stageScale) - (offsetY / stageScale);

            elemento.style.left = `${worldX}px`;
            elemento.style.top = `${worldY}px`;

            if (elemento.manejadoresMovimiento) {
                elemento.manejadoresMovimiento.forEach(fn => fn());
            }
        });

        document.addEventListener('mouseup', () => {
            if (arrastrando) {
                arrastrando = false;
                elemento.style.cursor = 'move';
                saveToLocalStorage();
            }
        });
    }

    /* ===== Pan del stage (ratón) ===== */

    stage.addEventListener('mousedown', (e) => {
        if (e.target.closest('.shape') || e.target.closest('.arrow') || e.target.closest('.ortho-arrow')) return;
        if (modoFlechaActivo) return;

        isPanning = true;
        stage.classList.add('panning');
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartOffsetX = stageOffsetX;
        panStartOffsetY = stageOffsetY;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        stageOffsetX = panStartOffsetX + dx;
        stageOffsetY = panStartOffsetY + dy;
        updateStageTransform();
    });

    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            stage.classList.remove('panning');
        }
    });

    /* ===== Zoom con rueda (ratón) ===== */

    stage.addEventListener('wheel', (e) => {
        e.preventDefault();

        const rectStage = stage.getBoundingClientRect();
        const sx = e.clientX - rectStage.left;
        const sy = e.clientY - rectStage.top;

        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        let newScale = stageScale + delta;
        newScale = Math.max(stageMinScale, Math.min(stageMaxScale, newScale));
        if (newScale === stageScale) return;

        const worldX = (sx - stageOffsetX) / stageScale;
        const worldY = (sy - stageOffsetY) / stageScale;

        stageScale = newScale;

        stageOffsetX = sx - worldX * stageScale;
        stageOffsetY = sy - worldY * stageScale;

        updateStageTransform();
        flechas.forEach(f => actualizarPosicionFlecha(f));
    });

    /* ======================================================
       SOPORTE PANTALLAS TÁCTILES: arrastre, pan y pinch-zoom
       ====================================================== */

    let touchDraggingElement = null;
    let touchOffsetX = 0;
    let touchOffsetY = 0;

    let isTouchPanning = false;
    let lastTouchX = 0;
    let lastTouchY = 0;

    let pinchStartDistance = 0;
    let initialScale = 1;

    function distanciaEntreTouches(t1, t2) {
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // touchstart
    stage.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const t = e.touches[0];
            const targetShape = t.target.closest('.shape');

            const port = t.target.closest('.port');
            const shape = t.target.closest('.shape');

            if (modoFlechaActivo) {
                const nodo = port || shape;
                if (nodo) {
                    nodo.click();
                }
                return;
            }

            // Arrastrar forma con un dedo
            if (targetShape && !isTouchPanning) {
                touchDraggingElement = targetShape;
                const rect = targetShape.getBoundingClientRect();
                touchOffsetX = t.clientX - rect.left;
                touchOffsetY = t.clientY - rect.top;
                e.preventDefault();
                return;
            }

            // Pan con un dedo en espacio vacío
            if (!shape) {
                isTouchPanning = true;
                lastTouchX = t.clientX;
                lastTouchY = t.clientY;
                return;
            }
        }

        // Pinch (dos dedos)
        if (e.touches.length === 2) {
            isTouchPanning = false;
            touchDraggingElement = null;

            pinchStartDistance = distanciaEntreTouches(e.touches[0], e.touches[1]);
            initialScale = stageScale;
        }
    });

    // touchmove
    stage.addEventListener('touchmove', (e) => {
        // Arrastre de forma
        if (touchDraggingElement && e.touches.length === 1) {
            const t = e.touches[0];
            const rectStage = stage.getBoundingClientRect();

            const sx = t.clientX - rectStage.left;
            const sy = t.clientY - rectStage.top;

            const worldX = ((sx - stageOffsetX) / stageScale) - (touchOffsetX / stageScale);
            const worldY = ((sy - stageOffsetY) / stageScale) - (touchOffsetY / stageScale);

            touchDraggingElement.style.left = `${worldX}px`;
            touchDraggingElement.style.top = `${worldY}px`;

            if (touchDraggingElement.manejadoresMovimiento) {
                touchDraggingElement.manejadoresMovimiento.forEach(fn => fn());
            }

            e.preventDefault();
            return;
        }

        // Pan con un dedo
        if (isTouchPanning && e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - lastTouchX;
            const dy = t.clientY - lastTouchY;

            stageOffsetX += dx;
            stageOffsetY += dy;

            lastTouchX = t.clientX;
            lastTouchY = t.clientY;

            updateStageTransform();
            flechas.forEach(f => actualizarPosicionFlecha(f));
            e.preventDefault();
            return;
        }

        // Pinch zoom con dos dedos
        if (e.touches.length === 2) {
            const newDist = distanciaEntreTouches(e.touches[0], e.touches[1]);
            let scaleFactor = newDist / pinchStartDistance;

            let newScale = initialScale * scaleFactor;
            newScale = Math.max(stageMinScale, Math.min(stageMaxScale, newScale));

            const rectStage = stage.getBoundingClientRect();
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rectStage.left;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rectStage.top;

            const worldX = (cx - stageOffsetX) / stageScale;
            const worldY = (cy - stageOffsetY) / stageScale;

            stageScale = newScale;
            stageOffsetX = cx - worldX * stageScale;
            stageOffsetY = cy - worldY * stageScale;

            updateStageTransform();
            flechas.forEach(f => actualizarPosicionFlecha(f));
            e.preventDefault();
        }
    });

    // touchend
    stage.addEventListener('touchend', () => {
        if (touchDraggingElement) {
            touchDraggingElement = null;
            saveToLocalStorage();
        }
        isTouchPanning = false;
    });

    /* ===== Borrado con tecla Supr/Delete ===== */

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete') return;
        if (!elementoSeleccionado) return;

        if (elementoSeleccionado.classList.contains('arrow') ||
            elementoSeleccionado.classList.contains('ortho-arrow')) {

            const obj = flechas.find(f => f.flecha === elementoSeleccionado);
            if (obj) {
                eliminarFlecha(obj);
            } else {
                elementoSeleccionado.remove();
            }
            elementoSeleccionado = null;
            saveToLocalStorage();
            return;
        }

        if (elementoSeleccionado.classList.contains('shape')) {
            const relacionadas = flechas.filter(f =>
                f.shapeInicio === elementoSeleccionado ||
                f.shapeFin === elementoSeleccionado
            );
            relacionadas.forEach(eliminarFlecha);

            elementoSeleccionado.remove();
            elementoSeleccionado = null;
            saveToLocalStorage();
        }
    });

    function eliminarFlecha(objFlecha) {
        const { flecha, shapeInicio, shapeFin, manejadorMovimiento } = objFlecha;
        flecha.remove();

        if (shapeInicio.manejadoresMovimiento) {
            shapeInicio.manejadoresMovimiento =
                shapeInicio.manejadoresMovimiento.filter(fn => fn !== manejadorMovimiento);
        }
        if (shapeFin.manejadoresMovimiento) {
            shapeFin.manejadoresMovimiento =
                shapeFin.manejadoresMovimiento.filter(fn => fn !== manejadorMovimiento);
        }

        flechas = flechas.filter(f => f !== objFlecha);
        saveToLocalStorage();
    }

    /* ===== Guardar JSON ===== */

    saveBtn.addEventListener('click', () => {
        const datos = exportDiagramAsJSON();
        descargarBlob(datos, 'diagrama.json', 'application/json');
        saveToLocalStorage();
    });

    /* ===== Cargar JSON (archivo) ===== */

    uploadBtn.addEventListener('click', () => {
        uploadInput.click();
    });

    uploadInput.addEventListener('change', (e) => {
        const archivo = e.target.files[0];
        if (!archivo) return;

        const reader = new FileReader();
        reader.onload = (evento) => {
            const json = JSON.parse(evento.target.result);
            rebuildFromData(json);
            saveToLocalStorage();
        };
        reader.readAsText(archivo);
    });

    /* ===== Botón limpiar lienzo ===== */

    clearBtn.addEventListener('click', () => {
        const ok = confirm('¿Seguro que quieres limpiar el lienzo? Se perderá el diagrama actual salvo que lo hayas exportado.');
        if (!ok) return;
        clearStage();
    });

    /* ===== Exportar SVG ===== */

    exportSvgBtn.addEventListener('click', () => {
        const shapes = Array.from(stageInner.querySelectorAll('.shape'));
        if (!shapes.length && !flechas.length) {
            alert('No hay nada que exportar.');
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        function expandBBox(x, y, w, h) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }

        shapes.forEach(el => {
            const r = worldRect(el);
            expandBBox(r.x, r.y, r.width, r.height);
        });

        flechas.forEach(f => {
            const pts = getConnectionPoints(f.formaInicio, f.formaFin);
            expandBBox(pts.startX, pts.startY, 0, 0);
            expandBBox(pts.endX, pts.endY, 0, 0);
            if (f.estilo === 'ortho') {
                expandBBox(pts.endX, pts.startY, 0, 0);
            }
        });

        if (minX === Infinity) {
            alert('No hay nada que exportar.');
            return;
        }

        const width = (maxX - minX) + 2 * EXPORT_PADDING;
        const height = (maxY - minY) + 2 * EXPORT_PADDING;

        const svgParts = [];
        svgParts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" ` +
            `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        );

        svgParts.push(`
  <defs>
    <style>
      text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 12px; fill: #111827; }
      .shape-rect { fill: #ffffff; stroke: #9ca3af; stroke-width: 1; }
      .shape-entity { fill: #ffffff; stroke: #111827; stroke-width: 2; }
      .shape-circle { fill: #ffffff; stroke: #9ca3af; stroke-width: 1; }
      .shape-pill { fill: #ffffff; stroke: #9ca3af; stroke-width: 1; }
      .shape-db { fill: #ffffff; stroke: #9ca3af; stroke-width: 1; }
      .conn { stroke: #111827; stroke-width: 2; fill: none; }
    </style>
    <marker id="arrow-end" markerWidth="10" markerHeight="7" refX="10" refY="3.5"
            orient="auto" markerUnits="strokeWidth">
      <polygon points="0 0, 10 3.5, 0 7" fill="#111827"/>
    </marker>
    <marker id="arrow-start" markerWidth="10" markerHeight="7" refX="0" refY="3.5"
            orient="auto" markerUnits="strokeWidth">
      <polygon points="10 0, 0 3.5, 10 7" fill="#111827"/>
    </marker>
  </defs>
        `);

        function toSvgCoords(x, y) {
            return {
                x: x - minX + EXPORT_PADDING,
                y: y - minY + EXPORT_PADDING
            };
        }

        function escapeXml(str) {
            return str.replace(/[<>&"']/g, c => {
                switch (c) {
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '&': return '&amp;';
                    case '"': return '&quot;';
                    case "'": return '&apos;';
                    default: return c;
                }
            });
        }

        // Formas
        shapes.forEach(el => {
            const tipo = Array.from(el.classList)
                .find(cls => ['rectangle', 'pill', 'circle', 'db', 'entity', 'text'].includes(cls));
            const r = worldRect(el);
            const pos = toSvgCoords(r.x, r.y);
            const x = pos.x;
            const y = pos.y;
            const w = r.width;
            const h = r.height;

            if (tipo === 'rectangle' || tipo === 'pill') {
                const rx = (tipo === 'pill') ? h / 2 : 4;
                svgParts.push(
                    `<rect class="shape-rect" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" />`
                );

                const text = (el.textContent || '').trim();
                if (text) {
                    svgParts.push(
                        `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${escapeXml(text)}</text>`
                    );
                }
            } else if (tipo === 'circle') {
                const cx = x + w / 2;
                const cy = y + h / 2;
                svgParts.push(
                    `<ellipse class="shape-circle" cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" />`
                );
                const text = (el.textContent || '').trim();
                if (text) {
                    svgParts.push(
                        `<text x="${cx}" y="${cy + 4}" text-anchor="middle">${escapeXml(text)}</text>`
                    );
                }
            } else if (tipo === 'db') {
                const topH = Math.min(18, h / 4);
                svgParts.push(
                    `<rect class="shape-db" x="${x}" y="${y + topH / 2}" width="${w}" height="${h - topH}" />`
                );
                svgParts.push(
                    `<ellipse class="shape-db" cx="${x + w / 2}" cy="${y + topH / 2}" rx="${w / 2}" ry="${topH / 2}" />`
                );
                svgParts.push(
                    `<ellipse class="shape-db" cx="${x + w / 2}" cy="${y + h}" rx="${w / 2}" ry="${topH / 2}" />`
                );
                const text = (el.textContent || '').trim();
                if (text) {
                    svgParts.push(
                        `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${escapeXml(text)}</text>`
                    );
                }
            } else if (tipo === 'entity') {
                svgParts.push(
                    `<rect class="shape-entity" x="${x}" y="${y}" width="${w}" height="${h}" />`
                );
                const header = el.querySelector('.entity-header');
                if (header) {
                    const hr = worldRect(header);
                    const hPos = toSvgCoords(hr.x, hr.y);
                    svgParts.push(
                        `<line x1="${x}" y1="${hPos.y + hr.height}" x2="${x + w}" y2="${hPos.y + hr.height}" ` +
                        `stroke="#e5e7eb" stroke-width="1"/>`
                    );
                    const hText = (header.textContent || '').trim();
                    if (hText) {
                        svgParts.push(
                            `<text x="${x + w / 2}" y="${hPos.y + hr.height / 2 + 4}" text-anchor="middle">${escapeXml(hText)}</text>`
                        );
                    }
                }
                el.querySelectorAll('.entity-property .property-name').forEach(nameEl => {
                    const pr = worldRect(nameEl);
                    const pPos = toSvgCoords(pr.x, pr.y);
                    const pText = (nameEl.textContent || '').trim();
                    if (pText) {
                        svgParts.push(
                            `<text x="${pPos.x + 4}" y="${pPos.y + pr.height / 2 + 4}">${escapeXml(pText)}</text>`
                        );
                    }
                });
            } else if (tipo === 'text') {
                const text = (el.textContent || '').trim();
                if (text) {
                    svgParts.push(
                        `<text x="${x}" y="${y + 14}">${escapeXml(text)}</text>`
                    );
                }
            }
        });

        // Conexiones
        flechas.forEach(f => {
            const pts = getConnectionPoints(f.formaInicio, f.formaFin);
            const s = toSvgCoords(pts.startX, pts.startY);
            const e = toSvgCoords(pts.endX, pts.endY);

            let d;
            if (f.estilo === 'ortho') {
                const elbow = toSvgCoords(pts.endX, pts.startY);
                d = `M ${s.x} ${s.y} H ${elbow.x} V ${e.y}`;
            } else {
                d = `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
            }

            const markers =
                f.tipo === 'doble'
                    ? 'marker-start="url(#arrow-start)" marker-end="url(#arrow-end)"'
                    : 'marker-end="url(#arrow-end)"';

            svgParts.push(
                `<path class="conn" d="${d}" ${markers} />`
            );
        });

        svgParts.push('</svg>');
        const svgContent = svgParts.join('\n');
        descargarBlob(svgContent, 'diagrama.svg', 'image/svg+xml');
    });

    /* ===== Exportar HTML/CSS estático ===== */

    exportHtmlBtn.addEventListener('click', () => {
        const shapes = Array.from(stageInner.querySelectorAll('.shape'));
        if (!shapes.length && !flechas.length) {
            alert('No hay nada que exportar.');
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        function expandBBox(x, y, w, h) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }

        shapes.forEach(el => {
            const r = worldRect(el);
            expandBBox(r.x, r.y, r.width, r.height);
        });

        flechas.forEach(f => {
            const pts = getConnectionPoints(f.formaInicio, f.formaFin);
            expandBBox(pts.startX, pts.startY, 0, 0);
            expandBBox(pts.endX, pts.endY, 0, 0);
            if (f.estilo === 'ortho') {
                expandBBox(pts.endX, pts.startY, 0, 0);
            }
        });

        if (minX === Infinity) {
            alert('No hay nada que exportar.');
            return;
        }

        const width = (maxX - minX) + 2 * EXPORT_PADDING;
        const height = (maxY - minY) + 2 * EXPORT_PADDING;

        function toPageCoords(x, y) {
            return {
                x: x - minX + EXPORT_PADDING,
                y: y - minY + EXPORT_PADDING
            };
        }

        function escapeHtml(str) {
            return str.replace(/[&<>"']/g, c => {
                switch (c) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '"': return '&quot;';
                    case "'": return '&#39;';
                    default: return c;
                }
            });
        }

        const htmlParts = [];
        htmlParts.push(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Diagrama exportado</title>
<style>
body {
  margin: 0;
  padding: 20px;
  background: #f3f3f7;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.page {
  position: relative;
  background: #ffffff;
  border: 1px solid #d1d5db;
  box-shadow: 0 2px 4px rgba(0,0,0,.1);
  width: ${width}px;
  height: ${height}px;
  overflow: visible;
}

/* formas básicas */
.shape {
  position: absolute;
  min-width: 120px;
  min-height: 40px;
  padding: 6px 10px;
  background: #ffffff;
  border-radius: 4px;
  border: 1px solid #9ca3af;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}

.shape.rectangle {
  border-radius: 4px;
}

.shape.pill {
  border-radius: 999px;
}

.shape.circle {
  border-radius: 999px;
  width: 80px;
  height: 80px;
  padding: 0;
  justify-content: center;
}

/* texto libre */
.shape.text {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  min-width: 20px;
  min-height: 20px;
}

/* base de datos */
.shape.db {
  min-width: 120px;
  min-height: 60px;
  padding-top: 20px;
  border-radius: 60px / 16px;
  background: linear-gradient(180deg, #e5e7eb 0%, #ffffff 40%, #e5e7eb 100%);
  position: absolute;
  overflow: hidden;
  text-align: center;
}
.shape.db::before {
  content: "";
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid #9ca3af;
  background: radial-gradient(circle at 50% 30%, #ffffff 0%, #e5e7eb 70%);
}
.shape.db::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(156, 163, 175, 0.6);
  border-top: none;
  background: radial-gradient(circle at 50% 70%, #e5e7eb 0%, #d1d5db 70%);
}

/* entidades ER */
.shape.entity {
  width: 220px;
  min-height: 80px;
  background: #ffffff;
  border: 2px solid #111827;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,.15);
  display: flex;
  flex-direction: column;
  font-size: 13px;
  overflow: hidden;
  padding: 0;
}
.entity-header {
  background: #f3f4f6;
  padding: 4px 8px;
  font-weight: 600;
  text-align: center;
  border-bottom: 1px solid #e5e7eb;
}
.entity-properties {
  flex: 1;
  padding: 4px 4px 0 4px;
}
.entity-property {
  display: grid;
  grid-template-columns: 14px 1fr 14px;
  align-items: center;
  column-gap: 4px;
  padding: 2px 0;
}
.entity-property .property-name {
  padding: 2px 4px;
  border-radius: 3px;
}

/* puertos */
.port {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid #111827;
  background: #ffffff;
}
.port-left { justify-self: start; }
.port-right { justify-self: end; }

/* flechas rectas */
.arrow {
  position: absolute;
  height: 2px;
  background: #111827;
  transform-origin: 0 50%;
}
.arrow::after {
  content: "";
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid #111827;
}
.arrow-double::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) rotate(180deg);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid #111827;
}

/* flechas ortogonales */
.ortho-arrow {
  position: absolute;
  left: 0;
  top: 0;
}
.ortho-arrow .ortho-seg {
  position: absolute;
  background: #111827;
}
.ortho-seg.seg-horizontal { height: 2px; }
.ortho-seg.seg-vertical { width: 2px; }
.ortho-arrowhead {
  position: absolute;
  width: 0;
  height: 0;
}
.ortho-arrowhead.dir-right {
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid #111827;
}
.ortho-arrowhead.dir-left {
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-right: 8px solid #111827;
}
.ortho-arrowhead.dir-down {
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 8px solid #111827;
}
.ortho-arrowhead.dir-up {
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 8px solid #111827;
}
</style>
</head>
<body>
<div class="page">
`);

        // Formas
        shapes.forEach(el => {
            const tipo = Array.from(el.classList)
                .find(cls => ['rectangle', 'pill', 'circle', 'db', 'entity', 'text'].includes(cls));
            const r = worldRect(el);
            const pos = toPageCoords(r.x, r.y);
            const x = pos.x;
            const y = pos.y;
            const w = r.width;
            const h = r.height;

            if (tipo === 'entity') {
                const header = el.querySelector('.entity-header');
                const entityName = header ? escapeHtml((header.textContent || '').trim()) : 'Entidad';

                htmlParts.push(
`<div class="shape entity" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;">
  <div class="entity-header">${entityName}</div>
  <div class="entity-properties">`
                );

                el.querySelectorAll('.entity-property').forEach(propEl => {
                    const nameEl = propEl.querySelector('.property-name');
                    const pText = escapeHtml((nameEl ? nameEl.textContent : 'atributo') || '');
                    htmlParts.push(
`    <div class="entity-property">
      <div class="port port-left"></div>
      <div class="property-name">${pText}</div>
      <div class="port port-right"></div>
    </div>`
                    );
                });

                htmlParts.push(
`  </div>
</div>`
                );
            } else {
                const text = escapeHtml((el.textContent || '').trim());
                htmlParts.push(
`<div class="shape ${tipo}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;">${text}</div>`
                );
            }
        });

        // Flechas
        flechas.forEach(f => {
            const pts = getConnectionPoints(f.formaInicio, f.formaFin);
            const s = toPageCoords(pts.startX, pts.startY);
            const e = toPageCoords(pts.endX, pts.endY);
            const dx = e.x - s.x;
            const dy = e.y - s.y;
            const length = Math.sqrt(dx * dx + dy * dy);

            if (f.estilo === 'straight') {
                const angle = Math.atan2(dy, dx);
                const classes = ['arrow'];
                if (f.tipo === 'doble') classes.push('arrow-double');
                htmlParts.push(
`<div class="${classes.join(' ')}" style="left:${s.x}px;top:${s.y}px;width:${length}px;transform:rotate(${angle}rad);"></div>`
                );
            } else {
                const elbow = toPageCoords(pts.endX, pts.startY);
                const seg1Left = Math.min(s.x, elbow.x);
                const seg1Width = Math.abs(elbow.x - s.x);

                const seg2Top = Math.min(elbow.y, e.y);
                const seg2Height = Math.abs(e.y - elbow.y);

                const classes = ['ortho-arrow'];
                if (f.tipo === 'doble') classes.push('ortho-arrow-double');

                let headEndClass, headEndLeft, headEndTop;
                if (Math.abs(e.y - elbow.y) >= Math.abs(e.x - elbow.x)) {
                    if (e.y >= elbow.y) {
                        headEndClass = 'dir-down';
                        headEndLeft = e.x - 4;
                        headEndTop = e.y;
                    } else {
                        headEndClass = 'dir-up';
                        headEndLeft = e.x - 4;
                        headEndTop = e.y - 8;
                    }
                } else {
                    if (e.x >= s.x) {
                        headEndClass = 'dir-right';
                        headEndLeft = e.x;
                        headEndTop = e.y - 4;
                    } else {
                        headEndClass = 'dir-left';
                        headEndLeft = e.x - 8;
                        headEndTop = e.y - 4;
                    }
                }

                let headStartMarkup = '';
                if (f.tipo === 'doble') {
                    let headStartClass, hsLeft, hsTop;
                    if (Math.abs(e.x - s.x) >= Math.abs(e.y - s.y)) {
                        if (s.x <= elbow.x) {
                            headStartClass = 'dir-left';
                            hsLeft = s.x - 8;
                            hsTop = s.y - 4;
                        } else {
                            headStartClass = 'dir-right';
                            hsLeft = s.x;
                            hsTop = s.y - 4;
                        }
                    } else {
                        if (s.y <= e.y) {
                            headStartClass = 'dir-up';
                            hsLeft = s.x - 4;
                            hsTop = s.y - 8;
                        } else {
                            headStartClass = 'dir-down';
                            hsLeft = s.x - 4;
                            hsTop = s.y;
                        }
                    }
                    headStartMarkup =
`  <div class="ortho-arrowhead ortho-head-start ${headStartClass}" style="left:${hsLeft}px;top:${hsTop}px;"></div>`;
                }

                htmlParts.push(
`<div class="${classes.join(' ')}">
  <div class="ortho-seg seg-horizontal seg1" style="left:${seg1Left}px;top:${elbow.y}px;width:${seg1Width}px;"></div>
  <div class="ortho-seg seg-vertical seg2" style="left:${elbow.x}px;top:${seg2Top}px;height:${seg2Height}px;"></div>
  <div class="ortho-arrowhead ortho-head-end ${headEndClass}" style="left:${headEndLeft}px;top:${headEndTop}px;"></div>${headStartMarkup}
</div>`
                );
            }
        });

        htmlParts.push(`</div>
</body>
</html>`);

        const htmlContent = htmlParts.join('\n');
        descargarBlob(htmlContent, 'diagrama.html', 'text/html');
    });

    /* ===== Exportar Python (ER → dataclasses) ===== */

    exportPyBtn.addEventListener('click', () => {
        const py = generarPythonDesdeDiagrama();
        if (!py) {
            alert('No hay entidades ER para exportar.');
            return;
        }
        descargarBlob(py, 'diagrama.py', 'text/x-python');
    });

    function generarPythonDesdeDiagrama() {
        const entityEls = Array.from(stageInner.querySelectorAll('.shape.entity'));
        if (!entityEls.length) return '';

        // Utilidades internas
        function sanitizeName(raw) {
            const base = (raw || '').trim().toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '');
            return base || 'tabla';
        }

        function toClassName(raw) {
            const base = sanitizeName(raw);
            const parts = base.split('_').filter(Boolean);
            const name = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
            return name || 'Tabla';
        }

        function getPropertyInfoFromNode(node) {
            if (!node) return null;
            const propEl = node.closest('.entity-property');
            if (!propEl) return null;
            const entityEl = node.closest('.shape.entity');
            if (!entityEl) return null;

            const nameEl = propEl.querySelector('.property-name');
            const rawName = (nameEl ? nameEl.textContent : '').trim() || 'atributo';
            const colName = sanitizeName(rawName);

            return {
                entityEl,
                propEl,
                rawName,
                colName
            };
        }

        // Recoger entidades/columnas
        const entities = {};
        const tableOrder = [];

        entityEls.forEach(entEl => {
            const header = entEl.querySelector('.entity-header');
            const rawTableName = (header ? header.textContent : '').trim() || 'entidad';
            const tableName = sanitizeName(rawTableName);

            const columns = [];
            const pkColumns = [];
            const foreignKeys = [];

            const propRows = entEl.querySelectorAll('.entity-property .property-name');

            propRows.forEach(nameEl => {
                const rawName = (nameEl.textContent || '').trim() || 'atributo';
                const colName = sanitizeName(rawName);
                const lc = colName.toLowerCase();

                let type = 'VARCHAR(255)';
                let isPK = false;

                if (lc === 'id') {
                    type = 'INT';
                    isPK = true;
                } else if (lc.endsWith('_id')) {
                    type = 'INT';
                }

                columns.push({ name: colName, type, isPrimaryKey: isPK });

                if (isPK) {
                    pkColumns.push(colName);
                }
            });

            entities[entEl.id] = {
                id: entEl.id,
                domEl: entEl,
                name: tableName,
                columns,
                pkColumns,
                foreignKeys
            };
            tableOrder.push(entEl.id);
        });

        // Analizar flechas (FK + ISA)
        const isaRelations = []; // { parentId, childId }

        flechas.forEach(f => {
            const fromEntityEl = f.shapeInicio.closest('.shape.entity');
            const toEntityEl = f.shapeFin.closest('.shape.entity');

            if (!fromEntityEl || !toEntityEl || fromEntityEl === toEntityEl) return;
            if (!entities[fromEntityEl.id] || !entities[toEntityEl.id]) return;

            const fromProp = getPropertyInfoFromNode(f.formaInicio);
            const toProp = getPropertyInfoFromNode(f.formaFin);

            // Caso ISA: entidad ↔ entidad sin puertos
            if (!fromProp && !toProp) {
                isaRelations.push({
                    parentId: fromEntityEl.id,
                    childId: toEntityEl.id
                });
                return;
            }

            // Caso FK entre atributos
            let child = null;
            let parent = null;
            let fkColumn = null;

            if (fromProp && !toProp) {
                child = entities[fromProp.entityEl.id];
                parent = entities[toEntityEl.id];
                fkColumn = fromProp.colName;
            } else if (!fromProp && toProp) {
                child = entities[toProp.entityEl.id];
                parent = entities[fromEntityEl.id];
                fkColumn = toProp.colName;
            } else if (fromProp && toProp) {
                child = entities[fromProp.entityEl.id];
                parent = entities[toProp.entityEl.id];
                fkColumn = fromProp.colName;
            }

            if (child && parent && fkColumn) {
                child.foreignKeys.push({
                    column: fkColumn,
                    referencesTable: parent.name,
                    referencesColumn: 'id'
                });
            }
        });

        // Mapa hijo → padre (para herencia en Python)
        const isaParentMap = {};
        isaRelations.forEach(rel => {
            isaParentMap[rel.childId] = rel.parentId;
        });

        const lines = [];
        lines.push('from typing import Optional');
        lines.push('');

        tableOrder.forEach(id => {
            const ent = entities[id];
            if (!ent) return;

            const className = toClassName(ent.name);
            const parentId = isaParentMap[ent.id];
            const parentEnt = parentId ? entities[parentId] : null;
            const parentClassName = parentEnt ? toClassName(parentEnt.name) : null;

            if (parentClassName) {
                lines.push(`class ${className}(${parentClassName}):`);
            } else {
                lines.push(`class ${className}:`);
            }

            if (!ent.columns.length && !ent.foreignKeys.length) {
                lines.push('    pass');
                lines.push('');
                return;
            }

            function pyTypeFromSql(sqlType) {
                const t = (sqlType || '').toUpperCase();
                if (t.startsWith('INT')) return 'int';
                return 'str';
            }

            const params = ent.columns.map(col => {
                const pyType = pyTypeFromSql(col.type);
                return `${col.name}: Optional[${pyType}] = None`;
            });

            lines.push(`    def __init__(self, ${params.join(', ')}):`);
            ent.columns.forEach(col => {
                lines.push(`        self.${col.name} = ${col.name}`);
            });
            lines.push('');

            const reprInner = ent.columns
                .map(col => `${col.name}={self.${col.name}!r}`)
                .join(', ');
            lines.push('    def __repr__(self):');
            lines.push(`        return f"${className}(${reprInner})"`);
            lines.push('');

            if (ent.foreignKeys.length) {
                ent.foreignKeys.forEach((fk, idx) => {
                    lines.push(
                        `    # FK${idx + 1}: ${fk.column} -> ${fk.referencesTable}.${fk.referencesColumn}`
                    );
                });
                lines.push('');
            }
        });

        return lines.join('\n');
    }

    /* ===== Exportar SQL (ER → tablas) ===== */

    exportSqlBtn.addEventListener('click', () => {
        const sql = generarSqlDesdeDiagrama();
        if (!sql) {
            alert('No hay entidades ER para exportar.');
            return;
        }
        descargarBlob(sql, 'diagrama.sql', 'text/sql');
    });

    function generarSqlDesdeDiagrama() {
        const entityEls = Array.from(stageInner.querySelectorAll('.shape.entity'));
        if (!entityEls.length) return '';

        function sanitizeName(raw) {
            const base = (raw || '').trim().toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '');
            return base || 'tabla';
        }

        function getPropertyInfoFromNode(node) {
            if (!node) return null;
            const propEl = node.closest('.entity-property');
            if (!propEl) return null;
            const entityEl = node.closest('.shape.entity');
            if (!entityEl) return null;

            const nameEl = propEl.querySelector('.property-name');
            const rawName = (nameEl ? nameEl.textContent : '').trim() || 'atributo';
            const colName = sanitizeName(rawName);

            return {
                entityEl,
                propEl,
                rawName,
                colName
            };
        }

        const entities = {};
        const tableOrder = [];

        entityEls.forEach(entEl => {
            const header = entEl.querySelector('.entity-header');
            const rawTableName = (header ? header.textContent : '').trim() || 'entidad';
            const tableName = sanitizeName(rawTableName);

            const columns = [];
            const pkColumns = [];
            const foreignKeys = [];

            const propRows = entEl.querySelectorAll('.entity-property .property-name');

            propRows.forEach(nameEl => {
                const rawName = (nameEl.textContent || '').trim() || 'atributo';
                const colName = sanitizeName(rawName);
                const lc = colName.toLowerCase();

                let type = 'VARCHAR(255)';
                let isPK = false;

                if (lc === 'id') {
                    type = 'INT';
                    isPK = true;
                } else if (lc.endsWith('_id')) {
                    type = 'INT';
                }

                columns.push({ name: colName, type, isPrimaryKey: isPK });

                if (isPK) {
                    pkColumns.push(colName);
                }
            });

            entities[entEl.id] = {
                id: entEl.id,
                domEl: entEl,
                name: tableName,
                columns,
                pkColumns,
                foreignKeys
            };
            tableOrder.push(entEl.id);
        });

        const isaRelations = [];

        flechas.forEach(f => {
            const fromEntityEl = f.shapeInicio.closest('.shape.entity');
            const toEntityEl = f.shapeFin.closest('.shape.entity');

            if (!fromEntityEl || !toEntityEl || fromEntityEl === toEntityEl) return;
            if (!entities[fromEntityEl.id] || !entities[toEntityEl.id]) return;

            const fromProp = getPropertyInfoFromNode(f.formaInicio);
            const toProp = getPropertyInfoFromNode(f.formaFin);

            if (!fromProp && !toProp) {
                isaRelations.push({
                    parentId: fromEntityEl.id,
                    childId: toEntityEl.id
                });
                return;
            }

            let child = null;
            let parent = null;
            let fkColumn = null;

            if (fromProp && !toProp) {
                child = entities[fromProp.entityEl.id];
                parent = entities[toEntityEl.id];
                fkColumn = fromProp.colName;
            } else if (!fromProp && toProp) {
                child = entities[toProp.entityEl.id];
                parent = entities[fromEntityEl.id];
                fkColumn = toProp.colName;
            } else if (fromProp && toProp) {
                child = entities[fromProp.entityEl.id];
                parent = entities[toProp.entityEl.id];
                fkColumn = fromProp.colName;
            }

            if (child && parent && fkColumn) {
                child.foreignKeys.push({
                    column: fkColumn,
                    referencesTable: parent.name,
                    referencesColumn: 'id'
                });
            }
        });

        const parentMap = {};
        isaRelations.forEach(rel => {
            parentMap[rel.childId] = rel.parentId;
        });

        const lines = [];

        tableOrder.forEach(id => {
            const ent = entities[id];
            if (!ent) return;

            const parentId = parentMap[ent.id];
            const parentEnt = parentId ? entities[parentId] : null;
            const tableName = ent.name;

            lines.push(`CREATE TABLE ${tableName} (`);

            const colDefs = [];

            ent.columns.forEach(col => {
                colDefs.push(`  ${col.name} ${col.type}`);
            });

            if (ent.pkColumns.length) {
                colDefs.push(`  PRIMARY KEY (${ent.pkColumns.join(', ')})`);
            }

            ent.foreignKeys.forEach((fk, idx) => {
                colDefs.push(
                    `  CONSTRAINT fk_${tableName}_${idx + 1} FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencesTable}(${fk.referencesColumn})`
                );
            });

            if (parentEnt) {
                const parentPk = parentEnt.pkColumns[0] || 'id';
                colDefs.push(
                    `  CONSTRAINT fk_${tableName}_parent FOREIGN KEY (${parentPk}) REFERENCES ${parentEnt.name}(${parentPk})`
                );
            }

            lines.push(colDefs.join(',\n'));
            lines.push(');');
            lines.push('');
        });

        return lines.join('\n');
    }

    /* ===== Utilidad genérica de descarga ===== */

    function descargarBlob(contenido, nombre, tipo) {
        const blob = new Blob([contenido], { type: tipo });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    /* ===== Cargar autosave al iniciar ===== */

    const autosaved = loadFromLocalStorage();
    if (autosaved) {
        rebuildFromData(autosaved);
    }
});

