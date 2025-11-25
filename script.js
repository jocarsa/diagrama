document.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('stage');
    const tools = document.querySelectorAll('.tool');
    const saveBtn = document.getElementById('saveBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadInput = document.getElementById('uploadInput');

    // Contenedor interno para poder aplicar transform (pan/zoom)
    const stageInner = document.createElement('div');
    stageInner.classList.add('stage-inner');
    stage.appendChild(stageInner);

    let modoFlechaActivo = false;
    let tipoFlecha = 'simple'; // 'simple' | 'doble'
    let formaInicioSeleccionada = null;
    let formaFinSeleccionada = null;
    let flechas = [];
    let contadorFormas = 0;

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

    function updateStageTransform() {
        stageInner.style.transform =
            `translate(${stageOffsetX}px, ${stageOffsetY}px) scale(${stageScale})`;
    }

    function generarIdForma() {
        return `forma-${++contadorFormas}`;
    }

    /* ===== Herramientas ===== */

    tools.forEach(tool => {
        // Arrastre de formas
        tool.addEventListener('dragstart', (e) => {
            const shape = tool.dataset.shape;
            if (shape === 'rectangle' || shape === 'pill' || shape === 'circle') {
                e.dataTransfer.setData('shape', shape);
            }
        });

        // Clic en herramienta
        tool.addEventListener('click', () => {
            tools.forEach(t => t.classList.remove('active'));
            const shapeType = tool.dataset.shape;

            if (shapeType === 'arrow' || shapeType === 'bidirectional') {
                modoFlechaActivo = true;
                tipoFlecha = (shapeType === 'bidirectional') ? 'doble' : 'simple';
                stage.style.cursor = 'crosshair';
                tool.classList.add('active');

                formaInicioSeleccionada = null;
                formaFinSeleccionada = null;
                document.querySelectorAll('.shape').forEach(forma => {
                    forma.classList.remove('selected');
                });
            } else {
                modoFlechaActivo = false;
                stage.style.cursor = 'grab';
            }
        });
    });

    /* ===== Selección de formas y flechas + conexión ===== */

    stage.addEventListener('click', (e) => {
        const formaClicada = e.target.closest('.shape');
        const flechaClicada = e.target.closest('.arrow');

        if (modoFlechaActivo) {
            // Modo conexión: seleccionar dos formas y crear flecha
            if (!formaClicada) return;

            if (!formaInicioSeleccionada) {
                formaInicioSeleccionada = formaClicada;
                formaClicada.classList.add('selected');
            } else if (!formaFinSeleccionada && formaClicada !== formaInicioSeleccionada) {
                formaFinSeleccionada = formaClicada;
                formaClicada.classList.add('selected');

                crearFlecha(formaInicioSeleccionada, formaFinSeleccionada, tipoFlecha);

                formaInicioSeleccionada.classList.remove('selected');
                formaFinSeleccionada.classList.remove('selected');
                formaInicioSeleccionada = null;
                formaFinSeleccionada = null;

                // Salir de modo flecha después de crear una
                modoFlechaActivo = false;
                stage.style.cursor = 'grab';
                tools.forEach(t => t.classList.remove('active'));
            }
            return;
        }

        // Modo normal: selección para borrar
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
        document.querySelectorAll('.shape.selected, .arrow.selected')
            .forEach(el => el.classList.remove('selected'));
    }

    /* ===== Creación y actualización de flechas ===== */

    function crearFlecha(formaInicio, formaFin, tipo = 'simple') {
        const flecha = document.createElement('div');
        flecha.classList.add('arrow');
        if (tipo === 'doble') {
            flecha.classList.add('arrow-double');
        }

        stageInner.appendChild(flecha);

        const objFlecha = {
            flecha,
            formaInicio,
            formaFin,
            tipo,
            manejadorMovimiento: null
        };

        const manejadorMovimiento = () =>
            actualizarPosicionFlecha(objFlecha.flecha, objFlecha.formaInicio, objFlecha.formaFin);

        objFlecha.manejadorMovimiento = manejadorMovimiento;
        flechas.push(objFlecha);

        formaInicio.manejadoresMovimiento = formaInicio.manejadoresMovimiento || [];
        formaFin.manejadoresMovimiento = formaFin.manejadoresMovimiento || [];
        formaInicio.manejadoresMovimiento.push(manejadorMovimiento);
        formaFin.manejadoresMovimiento.push(manejadorMovimiento);

        actualizarPosicionFlecha(flecha, formaInicio, formaFin);
    }

    // Calcula el punto en el borde de un rectángulo en la dirección (haciaX, haciaY)
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

    function actualizarPosicionFlecha(flecha, formaInicio, formaFin) {
        const rectInicio = formaInicio.getBoundingClientRect();
        const rectFin = formaFin.getBoundingClientRect();
        const rectStage = stage.getBoundingClientRect();

        // Coordenadas de centro en pantalla relativas al stage
        const centroInicioScreenX = rectInicio.left + rectInicio.width / 2 - rectStage.left;
        const centroInicioScreenY = rectInicio.top + rectInicio.height / 2 - rectStage.top;
        const centroFinScreenX = rectFin.left + rectFin.width / 2 - rectStage.left;
        const centroFinScreenY = rectFin.top + rectFin.height / 2 - rectStage.top;

        // Pasar a coordenadas "mundo" (stageInner antes de transform)
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

        const dx = bordeFin.x - bordeInicio.x;
        const dy = bordeFin.y - bordeInicio.y;
        const longitud = Math.sqrt(dx * dx + dy * dy);

        if (longitud === 0) {
            flecha.style.width = '0px';
            return;
        }

        const angulo = Math.atan2(dy, dx);

        flecha.style.left = `${bordeInicio.x}px`;
        flecha.style.top = `${bordeInicio.y}px`;
        flecha.style.width = `${longitud}px`;
        flecha.style.transform = `rotate(${angulo}rad)`;
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

        // Convertir a coordenadas mundo (antes de transform)
        const worldX = (sx - stageOffsetX) / stageScale;
        const worldY = (sy - stageOffsetY) / stageScale;

        const forma = document.createElement('div');
        forma.id = generarIdForma();
        forma.classList.add('shape', tipoForma);

        // Los 70/35 originales como "semi-tamaño" de la forma
        forma.style.left = `${worldX - 70}px`;
        forma.style.top = `${worldY - 35}px`;
        forma.contentEditable = 'false';

        stageInner.appendChild(forma);
        hacerArrastrable(forma);
        prepararEdicionTexto(forma);
    });

    function prepararEdicionTexto(forma) {
        forma.addEventListener('dblclick', () => {
            forma.contentEditable = 'true';
            forma.focus();
        });

        forma.addEventListener('blur', () => {
            forma.contentEditable = 'false';
        });
    }

    /* ===== Arrastre de formas ===== */

    function hacerArrastrable(elemento) {
        let offsetX, offsetY, arrastrando = false;

        elemento.addEventListener('mousedown', (e) => {
            if (e.target === elemento && !modoFlechaActivo) {
                arrastrando = true;
                const rect = elemento.getBoundingClientRect();
                offsetX = e.clientX - rect.left;  // pantalla
                offsetY = e.clientY - rect.top;   // pantalla
                elemento.style.cursor = 'grabbing';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!arrastrando) return;
            const rectStage = stage.getBoundingClientRect();
            const sx = e.clientX - rectStage.left;
            const sy = e.clientY - rectStage.top;

            // Pasar a mundo, compensando pan/zoom y el offset de ratón
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
            }
        });
    }

    /* ===== Pan del stage ===== */

    stage.addEventListener('mousedown', (e) => {
        // Si se ha hecho clic en una forma o flecha, no pan
        if (e.target.closest('.shape') || e.target.closest('.arrow')) return;
        // Si estamos en modo flecha, tampoco pan
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

    /* ===== Zoom con rueda ===== */

    stage.addEventListener('wheel', (e) => {
        e.preventDefault();

        const rectStage = stage.getBoundingClientRect();
        const sx = e.clientX - rectStage.left;
        const sy = e.clientY - rectStage.top;

        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        let newScale = stageScale + delta;
        newScale = Math.max(stageMinScale, Math.min(stageMaxScale, newScale));
        if (newScale === stageScale) return;

        // Punto del mundo bajo el cursor antes del zoom
        const worldX = (sx - stageOffsetX) / stageScale;
        const worldY = (sy - stageOffsetY) / stageScale;

        stageScale = newScale;

        // Reajustar offset para mantener el punto bajo el cursor
        stageOffsetX = sx - worldX * stageScale;
        stageOffsetY = sy - worldY * stageScale;

        updateStageTransform();
        // Recalcular flechas después del zoom
        flechas.forEach(f =>
            actualizarPosicionFlecha(f.flecha, f.formaInicio, f.formaFin)
        );
    });

    /* ===== Borrado con tecla Supr/Delete ===== */

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete') return;
        if (!elementoSeleccionado) return;

        // Si es una flecha
        if (elementoSeleccionado.classList.contains('arrow')) {
            const obj = flechas.find(f => f.flecha === elementoSeleccionado);
            if (obj) {
                eliminarFlecha(obj);
            } else {
                elementoSeleccionado.remove();
            }
            elementoSeleccionado = null;
            return;
        }

        // Si es una forma
        if (elementoSeleccionado.classList.contains('shape')) {
            // Eliminar flechas asociadas
            const relacionadas = flechas.filter(f =>
                f.formaInicio === elementoSeleccionado ||
                f.formaFin === elementoSeleccionado
            );
            relacionadas.forEach(eliminarFlecha);

            elementoSeleccionado.remove();
            elementoSeleccionado = null;
        }
    });

    function eliminarFlecha(objFlecha) {
        const { flecha, formaInicio, formaFin, manejadorMovimiento } = objFlecha;
        flecha.remove();

        // eliminar manejadores de movimiento asociados
        if (formaInicio.manejadoresMovimiento) {
            formaInicio.manejadoresMovimiento =
                formaInicio.manejadoresMovimiento.filter(fn => fn !== manejadorMovimiento);
        }
        if (formaFin.manejadoresMovimiento) {
            formaFin.manejadoresMovimiento =
                formaFin.manejadoresMovimiento.filter(fn => fn !== manejadorMovimiento);
        }

        flechas = flechas.filter(f => f !== objFlecha);
    }

    /* ===== Guardar diagrama ===== */

    saveBtn.addEventListener('click', () => {
        const formas = [];
        stageInner.querySelectorAll('.shape').forEach(el => {
            const forma = {
                id: el.id,
                tipo: Array.from(el.classList).find(cls => ['rectangle', 'pill', 'circle'].includes(cls)),
                left: el.style.left,
                top: el.style.top,
                width: el.style.width,
                height: el.style.height,
                texto: el.textContent
            };
            formas.push(forma);
        });

        const datosFlechas = flechas.map(f => ({
            idInicio: f.formaInicio.id,
            idFin: f.formaFin.id,
            tipo: f.tipo || 'simple'
        }));

        const datos = JSON.stringify({ formas, flechas: datosFlechas }, null, 2);
        const blob = new Blob([datos], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'diagrama.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    /* ===== Cargar diagrama ===== */

    uploadBtn.addEventListener('click', () => {
        uploadInput.click();
    });

    uploadInput.addEventListener('change', (e) => {
        const archivo = e.target.files[0];
        if (!archivo) return;

        const reader = new FileReader();
        reader.onload = (evento) => {
            const { formas, flechas: datosFlechas } = JSON.parse(evento.target.result);
            stageInner.innerHTML = '';
            flechas = [];
            contadorFormas = 0;
            elementoSeleccionado = null;
            formaInicioSeleccionada = null;
            formaFinSeleccionada = null;

            const mapaFormas = {};

            formas.forEach(forma => {
                const el = document.createElement('div');
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

                mapaFormas[el.id] = el;
            });

            if (Array.isArray(datosFlechas)) {
                datosFlechas.forEach(df => {
                    const formaInicio = mapaFormas[df.idInicio];
                    const formaFin = mapaFormas[df.idFin];
                    const tipo = df.tipo || 'simple';
                    if (formaInicio && formaFin) {
                        crearFlecha(formaInicio, formaFin, tipo);
                    }
                });
            }

            // Restaurar transform por si se había pan/zoom
            stageScale = 1;
            stageOffsetX = 0;
            stageOffsetY = 0;
            updateStageTransform();
        };
        reader.readAsText(archivo);
    });

    // Inicializar transform
    updateStageTransform();
});

