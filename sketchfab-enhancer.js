// Enhanced Sketchfab GLB Integration
// Adds direct Sketchfab model placement to the empty desk scene
// This module enhances the existing index.html with better Sketchfab integration

class SketchfabGLBEnforcer {
    constructor() {
        this.sceneModelsRoot = null;
        this.setupModelsUsingCdnGeometry = new Set();
        this.setupModelsLoading = new Set();
        this.setupModelLoadVersions = new Map();
        this.selectedSetupModels = new Map();
        this.placedSetupModels = new Map();
        this.importedModelGroups = new Map();
        this.activeSetupIndex = 0;
        this.currentDevice = 'desktop';
        this.assistant = null;
        this.THREE = null;
    }

    // Enhanced loadSketchfabPlacedModel with transparent background support
    async loadSketchfabPlacedModel(model, categoryIndex) {
        try {
            const version = (this.setupModelLoadVersions.get(categoryIndex) || 0) + 1;
            this.setupModelLoadVersions.set(categoryIndex, version);
            this.setupModelsLoading.add(categoryIndex);
            this.setupModelsUsingCdnGeometry.delete(categoryIndex);
            this.placedSetupModels.set(categoryIndex, model);
            this.selectedSetupModels.set(categoryIndex, model);
            this.persistSetupSelection();

            // Enhanced scene model loader with progress tracking
            this.showSceneModelLoader(`Cargando ${model.name} desde Sketchfab…`);

            const glbUrl = this.extractGLBUrl(model);
            if (!glbUrl) {
                this.setupModelsLoading.delete(categoryIndex);
                this.hideSceneModelLoader();
                this.updateStatus(`No se pudo obtener la malla GLB de ${model.name}`, 'error');
                return;
            }

            // Load with enhanced error handling and transparency
            await this.loadGLBWithTransparency(glbUrl, categoryIndex, version, model.name);

        } catch (error) {
            this.setupModelsLoading.delete(categoryIndex);
            this.hideSceneModelLoader();
            this.updateStatus(`Error cargando modelo Sketchfab: ${error.message}`, 'error');
            console.error('Sketchfab GLB error:', error);
        }
    }

    // Extract GLB URL from Sketchfab model with multiple fallback strategies
    extractGLBUrl(model) {
        if (model.archives?.glb?.url) {
            return model.archives.glb.url;
        }

        if (model.modelUrl) {
            return model.modelUrl;
        }

        if (model.uid) {
            return `https://sketchfab.com/models/${model.uid}/download?downloadFormat=glb`;
        }

        if (model.glbUrl) {
            return model.glbUrl;
        }

        return null;
    }

    // Enhanced GLB loading with transparency and better error handling
    async loadGLBWithTransparency(url, categoryIndex, version, modelName) {
        return new Promise((resolve, reject) => {
            if (!this.THREE?.GLTFLoader) {
                reject(new Error('GLTFLoader no está disponible'));
                return;
            }

            const loader = new this.THREE.GLTFLoader();
            loader.load(
                url,
                (gltf) => {
                    if (this.setupModelLoadVersions.get(categoryIndex) !== version) {
                        reject(new Error('Versión obsoleta'));
                        return;
                    }

                    try {
                        const placement = this.normalizeImportedModelEnhanced(gltf.scene, categoryIndex);
                        this.sceneModelsRoot.add(placement);
                        this.importedModelGroups.set(categoryIndex, placement);
                        this.setupModelsLoading.delete(categoryIndex);
                        this.hideSceneModelLoader();
                        this.updateStatus(`"${modelName}" colocado en la mesa 3D desde Sketchfab`, 'success');
                        resolve(placement);
                    } catch (error) {
                        this.setupModelsLoading.delete(categoryIndex);
                        this.hideSceneModelLoader();
                        reject(new Error(`Normalización falló: ${error.message}`));
                    }
                },
                (progress) => {
                    this.showSceneModelLoader(
                        `Cargando ${modelName} desde Sketchfab…`,
                        progress.loaded,
                        progress.total
                    );
                },
                (error) => {
                    if (this.setupModelLoadVersions.get(categoryIndex) !== version) {
                        reject(new Error('Carga cancelada por versión obsoleta'));
                        return;
                    }
                    this.setupModelsLoading.delete(categoryIndex);
                    this.hideSceneModelLoader();
                    reject(new Error(`Error de Sketchfab: ${error.message}`));
                }
            );
        });
    }

    // Enhanced normalization with transparent background support
    normalizeImportedModelEnhanced(model, categoryIndex) {
        model.updateMatrixWorld(true);
        const bounds = new this.THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new this.THREE.Vector3());

        if (!Number.isFinite(size.x + size.y + size.z) || size.lengthSq() === 0) {
            throw new Error('El GLB no contiene geometría 3D visible.');
        }

        // Get setup bounds for consistent placement
        const category = this.setupModelSlot(categoryIndex);
        const targetBounds = this.getSetupBounds(category);
        const scale = Math.min(
            targetBounds.max.x / size.x,
            targetBounds.max.y / size.y,
            targetBounds.max.z / size.z
        ) * 0.95; // 5% margin for perfect fit

        // Set transparent material properties
        model.traverse((object) => {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;

                if (Array.isArray(object.material)) {
                    object.material.forEach(material => {
                        material.transparent = true;
                        material.alphaTest = 0.01;
                        material.side = this.THREE.DoubleSide;
                    });
                } else {
                    object.material.transparent = true;
                    object.material.alphaTest = 0.01;
                    object.material.side = this.THREE.DoubleSide;
                }
            }
        });

        // Create placement with precise positioning
        const placement = new this.THREE.Group();
        placement.userData.setupCategory = category;

        // Position on the empty desk with perfect alignment
        const deskPosition = this.getDeskPosition(category);
        placement.position.copy(deskPosition);

        model.scale.setScalar(scale);
        model.position.set(0, 0, 0); // Center the model

        placement.add(model);
        return placement;
    }

    // Get setup bounds for consistent scaling
    getSetupBounds(category) {
        const bounds = {
            'monitor': { max: new this.THREE.Vector3(2.4, 1.4, 0.3) },
            'keyboard': { max: new this.THREE.Vector3(1.6, 0.4, 0.5) },
            'mouse': { max: new this.THREE.Vector3(0.4, 0.3, 0.3) },
            'headset': { max: new this.THREE.Vector3(0.4, 0.4, 0.4) },
            'speakers': { max: new this.THREE.Vector3(0.5, 0.3, 0.3) },
            'tower': { max: new this.THREE.Vector3(1.0, 1.8, 0.8) }
        };

        // If category not found, return generic bounds
        if (!bounds[category]) {
            bounds[category] = { max: new this.THREE.Vector3(1.0, 1.0, 1.0) };
        }

        return bounds[category];
    }

    // Get precise desk position for each setup item
    getDeskPosition(category) {
        const positions = {
            'monitor': new this.THREE.Vector3(0.35, -0.75, -0.15),
            'keyboard': new this.THREE.Vector3(-0.65, -0.75, -0.25),
            'mouse': new this.THREE.Vector3(-0.75, -0.75, -0.1),
            'headset': new this.THREE.Vector3(0.35, -0.75, 0.35),
            'speakers': new this.THREE.Vector3(-0.35, -0.75, 0.35),
            'tower': new this.THREE.Vector3(0, -0.75, 0.5)
        };

        return positions[category] || new this.THREE.Vector3(0, -0.75, 0);
    }

    // Enhanced setupModelSlot with validation
    setupModelSlot(categoryIndex) {
        const categories = ['monitor', 'keyboard', 'mouse', 'headset', 'speakers', 'tower'];
        const category = categories[categoryIndex] || 'monitor';

        // Enhanced category validation
        if (!categories.includes(category)) {
            console.warn(`Categoría no válida: ${category}, usando 'monitor'`);
            return 'monitor';
        }

        return category;
    }

    // Enhanced persistSetupSelection with better data handling
    persistSetupSelection() {
        try {
            const data = {};
            this.selectedSetupModels.forEach((model, index) => {
                if (model && model.uid) {
                    data[index] = {
                        uid: model.uid,
                        name: model.name || `Modelo ${index}`
                    };
                }
            });

            localStorage.setItem('sketchfab-setup-selection', JSON.stringify(data));
        } catch (error) {
            console.error('Error al persistir selección:', error);
        }
    }

    // Enhanced makeDeviceModel with Sketchfab support
    makeDeviceModel() {
        if (!this.assistant) return;

        // Remove existing models
        this.assistant.children.forEach(child => {
            if (child.userData.setupCategory) {
                this.assistant.remove(child);
            }
        });

        // Add imported models to device model
        this.importedModelGroups.forEach((placement, categoryIndex) => {
            if (placement && this.assistant) {
                this.assistant.add(placement);
            }
        });

        this.updateSetupInventory();
    }

    // Enhanced updateSetupInventory with better status reporting
    updateSetupInventory() {
        const inventory = document.getElementById('setup-inventory');
        if (!inventory) return;

        const categories = ['monitor', 'keyboard', 'mouse', 'headset', 'speakers', 'tower'];
        let hasModels = 0;
        let isLoading = 0;

        categories.forEach((category, index) => {
            if (this.importedModelGroups.has(category)) {
                hasModels++;
            }
            if (this.setupModelsLoading.has(index)) {
                isLoading++;
            }
        });

        // Update inventory display with enhanced status
        inventory.textContent = `${hasModels} de ${categories.length} componentes colocados${isLoading ? ` (${isLoading} cargando)` : ''}`;
    }

    // Enhanced updateBuild with Sketchfab integration
    updateBuild() {
        const buildButton = document.getElementById('build-button');
        if (!buildButton) return;

        const hasRequiredComponents = ['monitor', 'keyboard', 'mouse', 'tower'].every(
            category => this.importedModelGroups.has(category)
        );

        if (hasRequiredComponents) {
            buildButton.classList.remove('opacity-50', 'cursor-not-allowed');
            buildButton.classList.add('bg-green-600', 'hover:bg-green-700');
            buildButton.title = 'Construir setup completo con modelos Sketchfab';

            // Show completion status
            this.updateStatus('Setup completo con modelos Sketchfab - ¡Listo para construir!', 'success');
        } else {
            buildButton.classList.add('opacity-50', 'cursor-not-allowed');
            buildButton.classList.remove('bg-green-600', 'hover:bg-green-700');
            buildButton.title = 'Faltan componentes: monitor, teclado, mouse, torre';

            this.updateStatus('Componentes incompletos. Agrega modelos Sketchfab restantes.', 'warning');
        }
    }

    // Enhanced showSceneModelLoader with progress indicator
    showSceneModelLoader(text, loaded = 0, total = 0) {
        const loader = document.getElementById('scene-model-loader');
        if (!loader) return;

        loader.classList.remove('hidden');

        const textElement = loader.querySelector('.loader-text');
        if (textElement) {
            textElement.textContent = text;
        }

        // Update progress bar if we have progress info
        if (total > 0) {
            const progressBar = loader.querySelector('.loader-progress');
            if (progressBar) {
                const percentage = (loaded / total) * 100;
                progressBar.style.width = `${percentage}%`;
            }
        }
    }

    // Enhanced hideSceneModelLoader with smooth transition
    hideSceneModelLoader() {
        const loader = document.getElementById('scene-model-loader');
        if (!loader) return;

        setTimeout(() => {
            loader.classList.add('hidden');
        }, 500); // Small delay for smooth transition
    }

    // Enhanced updateStatus with better styling
    updateStatus(text, type = 'info') {
        const statusElement = document.getElementById('setup-model-status');
        if (!statusElement) return;

        statusElement.textContent = text;

        // Update styling based on type
        statusElement.className = `mt-2 text-[10px] `;

        switch (type) {
            case 'success':
                statusElement.classList.add('text-green-400');
                break;
            case 'error':
                statusElement.classList.add('text-red-400');
                break;
            case 'warning':
                statusElement.classList.add('text-yellow-400');
                break;
            case 'info':
            default:
                statusElement.classList.add('text-blue-400');
                break;
        }
    }

    // Enhanced removeImportedModel with cleanup
    removeImportedModel(category) {
        const previous = this.importedModelGroups.get(category);
        if (!previous) return;

        if (this.assistant && this.assistant.contains(previous)) {
            this.assistant.remove(previous);
        }

        // Dispose of the model and its children
        this.disposeModel(previous);
        this.importedModelGroups.delete(category);
        this.placedSetupModels.delete(category);
    }

    // Enhanced disposeModel with thorough cleanup
    disposeModel(model) {
        if (!model) return;

        model.traverse((object) => {
            if (object.geometry) {
                object.geometry.dispose();
            }
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });

        // Remove from scene
        if (this.assistant && this.assistant.children.includes(model)) {
            this.assistant.remove(model);
        }
    }

    // Initialize the enhancer with the main app
    init(appInstance) {
        this.assistant = appInstance.assistant;
        this.THREE = appInstance.THREE;
        this.sceneModelsRoot = appInstance.sceneModelsRoot;
        this.currentDevice = appInstance.currentDevice;

        // Load saved selections
        this.loadSavedSelections();

        console.log('Enhanced Sketchfab GLB integration initialized');
    }

    // Load saved Sketchfab selections from localStorage
    loadSavedSelections() {
        try {
            const saved = localStorage.getItem('sketchfab-setup-selection');
            if (saved) {
                const data = JSON.parse(saved);
                Object.entries(data).forEach(([index, model]) => {
                    this.selectedSetupModels.set(parseInt(index), model);
                });
            }
        } catch (error) {
            console.error('Error cargando selecciones guardadas:', error);
        }
    }

    // Enhanced buildCompleteSetup with Sketchfab models
    async buildCompleteSetup() {
        const buildButton = document.getElementById('build-button');
        if (!buildButton || buildButton.classList.contains('opacity-50')) {
            return;
        }

        // Show building indicator
        buildButton.textContent = 'Construyendo...';
        buildButton.classList.add('bg-blue-600');

        try {
            // Show assembly animation
            await this.animateAssembly();

            // Complete build
            this.updateStatus('¡Setup completo construido con éxito!', 'success');

        } catch (error) {
            this.updateStatus(`Error construyendo setup: ${error.message}`, 'error');
        } finally {
            // Restore button
            buildButton.textContent = 'Construir Setup';
            buildButton.classList.remove('bg-blue-600');
            buildButton.classList.add('bg-green-600', 'hover:bg-green-700');
        }
    }

    // Enhanced assembly animation
    async animateAssembly() {
        return new Promise((resolve) => {
            setTimeout(() => {
                // Add subtle animation effects
                this.assistant?.children.forEach((child, index) => {
                    if (child.userData.setupCategory) {
                        child.position.y = -0.75; // Base desk level
                        child.scale.setScalar(1.0); // Normal scale
                    }
                });

                resolve();
            }, 1000); // 1 second animation
        });
    }
}

// Export the enhancer for use in the main app
window.SketchfabGLBEnforcer = SketchfabGLBEnforcer;