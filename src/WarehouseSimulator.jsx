import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Package, Users, Clock, TrendingUp, Thermometer, Upload, Battery } from 'lucide-react';

export default function WarehouseSimulator() {
  const mountRef = useRef(null);
  const [metrics, setMetrics] = useState({
    ordersProcessed: 0,
    avgPickTime: 0,
    totalTime: 0,
    palletsMoved: 0,
    utilization: 0,
    completedDemands: 0
  });
  
  const [liveActivity, setLiveActivity] = useState([]);
  const processedDemandsRef = useRef(new Set()); // İşlenmiş talepler // Canlı aktivite
  
  const [isRunning, setIsRunning] = useState(false);
  const sceneRef = useRef(null);
  const vnaForkliftsRef = useRef([]);
  const ordersRef = useRef([]);
  
  const [warehouseLayout, setWarehouseLayout] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [demandOrders, setDemandOrders] = useState([]);
  const [shelfMap, setShelfMap] = useState({});
  
  const [config, setConfig] = useState({
    vnaCount: 1,
    speedKmPerHour: 3.6  // km/saat (1 m/s = 3.6 km/h)
  });
  
  const [filesLoaded, setFilesLoaded] = useState({
    layout: false,
    inventory: false,
    demand: false
  });
  
  const palletType = { width: 0.8, depth: 1.2, height: 0.15 };
  
  const mouseRef = useRef({
    isDown: false,
    startX: 0,
    startY: 0,
    phi: Math.PI / 4,
    theta: Math.PI / 4,
    radius: 35
  });

  // Excel okuma
  const handleFileUpload = async (file, type) => {
    if (!window.XLSX) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => handleFileUpload(file, type);
      document.head.appendChild(script);
      return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
        
        if (type === 'layout') {
          setWarehouseLayout(jsonData);
          setFilesLoaded(prev => ({...prev, layout: true}));
        } else if (type === 'inventory') {
          setInventory(jsonData);
          setFilesLoaded(prev => ({...prev, inventory: true}));
        } else if (type === 'demand') {
          const sorted = jsonData.sort((a, b) => new Date(a.Shipping_Date) - new Date(b.Shipping_Date));
          setDemandOrders(sorted);
          setFilesLoaded(prev => ({...prev, demand: true}));
        }
      } catch (error) {
        alert('Excel hatası: ' + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 3D Sahne
  useEffect(() => {
    if (!mountRef.current || !filesLoaded.layout || warehouseLayout.length === 0) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a15);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000);
    
    const updateCamera = () => {
      const { phi, theta, radius } = mouseRef.current;
      camera.position.x = radius * Math.sin(phi) * Math.cos(theta);
      camera.position.y = radius * Math.sin(theta) + 10;
      camera.position.z = radius * Math.cos(phi) * Math.cos(theta);
      camera.lookAt(0, 5, 0);
    };
    updateCamera();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);

    const onMouseDown = (e) => {
      mouseRef.current.isDown = true;
      mouseRef.current.startX = e.clientX;
      mouseRef.current.startY = e.clientY;
    };

    const onMouseMove = (e) => {
      if (!mouseRef.current.isDown) return;
      const deltaX = e.clientX - mouseRef.current.startX;
      const deltaY = e.clientY - mouseRef.current.startY;
      mouseRef.current.phi += deltaX * 0.01;
      mouseRef.current.theta = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, mouseRef.current.theta - deltaY * 0.01));
      mouseRef.current.startX = e.clientX;
      mouseRef.current.startY = e.clientY;
      updateCamera();
    };

    const onMouseUp = () => { mouseRef.current.isDown = false; };
    const onWheel = (e) => {
      e.preventDefault();
      mouseRef.current.radius = Math.max(15, Math.min(80, mouseRef.current.radius + e.deltaY * 0.05));
      updateCamera();
    };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(30, 50, 30);
    mainLight.castShadow = true;
    scene.add(mainLight);

    const floorSize = 80;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      new THREE.MeshStandardMaterial({ color: 0x1a1a2e })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(floorSize, 50, 0x333366, 0x222244);
    grid.position.y = 0.01;
    scene.add(grid);

    const newShelfMap = {};
    const corridorSpacing = 10;
    const rowSpacing = 1.5;
    
    warehouseLayout.forEach((shelf) => {
      const corridor = parseInt(shelf.Corridor);
      const side = shelf.Side;
      const x = parseInt(shelf.X);
      const y = parseInt(shelf.Y);
      
      const locationKey = `${String(corridor).padStart(2, '0')}-${side}-${String(x).padStart(3, '0')}-${String(y).padStart(2, '0')}`;
      
      const posX = (side === 'A' ? -2 : 2) + (corridor - 1) * corridorSpacing;
      const posZ = (x - 1) * rowSpacing;
      const posY = (y - 1) * 1.4;
      
      const group = new THREE.Group();
      
      const level = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.05, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x34495e })
      );
      level.position.y = posY;
      level.castShadow = true;
      group.add(level);

      const palletMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.15, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x5d4037 })
      );
      palletMesh.position.y = posY + 0.1;
      palletMesh.castShadow = true;
      palletMesh.visible = true;
      group.add(palletMesh);

      const boxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.7, 0.9),
        new THREE.MeshStandardMaterial({ color: 0xf39c12 })
      );
      boxMesh.position.y = posY + 0.5;
      boxMesh.castShadow = true;
      boxMesh.visible = true;
      group.add(boxMesh);

      group.position.set(posX, 0, posZ);
      scene.add(group);
      
      newShelfMap[locationKey] = {
        position: new THREE.Vector3(posX, posY, posZ),
        mesh: group,
        palletMesh: palletMesh,
        boxMesh: boxMesh,
        corridor,
        side,
        x,
        y,
        hasPallet: true
      };
    });
    
    setShelfMap(newShelfMap);

    // Robot oluştur
    const corridors = [...new Set(warehouseLayout.map(s => parseInt(s.Corridor)))];
    vnaForkliftsRef.current = [];
    
    corridors.slice(0, config.vnaCount).forEach((corridor, idx) => {
      const group = new THREE.Group();
      
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.8, 0.9),
        new THREE.MeshStandardMaterial({ color: 0xff6b35, metalness: 0.6, roughness: 0.4 })
      );
      body.position.y = 0.9;
      body.castShadow = true;
      group.add(body);
      
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.6, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x2c3e50 })
      );
      head.position.y = 2.1;
      head.castShadow = true;
      group.add(head);

      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 1 })
      );
      light.position.set(0, 2.3, 0.4);
      group.add(light);

      const forkGroup = new THREE.Group();
      [-0.35, 0.35].forEach(xPos => {
        const fork = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 1.2, 1.2),
          new THREE.MeshStandardMaterial({ color: 0x7f8c8d, metalness: 0.8 })
        );
        fork.position.set(xPos, 0.6, 0.7);
        fork.castShadow = true;
        forkGroup.add(fork);
      });
      group.add(forkGroup);
      
      const wheelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.15, 16);
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
      
      [[-0.5, 0.2, 0.4], [0.5, 0.2, 0.4], [-0.5, 0.2, -0.4], [0.5, 0.2, -0.4]].forEach(([x, y, z]) => {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, y, z);
        wheel.rotation.z = Math.PI / 2;
        wheel.castShadow = true;
        group.add(wheel);
      });

      const startPosX = (corridor - 1) * corridorSpacing;
      const startPosZ = 0; // Koridor sıra 1 (0 pozisyonu)
      
      group.position.set(startPosX, 0, startPosZ);
      scene.add(group);
      
      vnaForkliftsRef.current.push({
        id: idx,
        mesh: group,
        forks: forkGroup,
        assignedCorridor: corridor,
        homePosition: new THREE.Vector3(startPosX, 0, startPosZ - 2), // Sıra 1'in hemen önü
        busy: false,
        target: null,
        targetShelf: null,
        carriedPallet: null,
        speed: 0.12,
        startTime: null,
        forkHeight: 0,
        state: 'idle',
        battery: 100,
        hasPallet: false
      });
    });

    // Animasyon
    let lastOrderTime = Date.now();
    
    const animate = () => {
      requestAnimationFrame(animate);

      if (isRunning && filesLoaded.demand) {
        
        // Tüm talepler tamamlandı mı kontrol et
        if (processedDemandsRef.current.size >= demandOrders.length && ordersRef.current.length === 0) {
          console.log('🎉 TÜM TALEPLER TAMAMLANDI! Simülasyon durduruluyor...');
          setIsRunning(false);
          return;
        }
        
        // Sipariş atama
        if (Date.now() - lastOrderTime > 3000 && ordersRef.current.length < config.vnaCount * 2) {
          
          // İşlenmiş Material_ID'leri topla
          const processedMaterials = processedDemandsRef.current;
          
          const availableOrders = demandOrders.filter(order => 
            !processedMaterials.has(order.Material_ID)
          );
          
          console.log('📋 Sipariş kontrol - Tamamlanan:', processedDemandsRef.current.size, '/', demandOrders.length, 'Bekleyen:', availableOrders.length, 'Aktif:', ordersRef.current.length);
          
          if (availableOrders.length > 0) {
            const nextOrder = availableOrders[0];
            console.log('🔍 Sıradaki sipariş - Material_ID:', nextOrder.Material_ID, 'Demand:', nextOrder.Demand_Qty);
            
            const stockItems = inventory.filter(item => 
              item.Material_ID === nextOrder.Material_ID && 
              item.Stock_Qty > 0
            ).sort((a, b) => new Date(a.Goods_Receipt_Date) - new Date(b.Goods_Receipt_Date));
            
            console.log('📦 Envanterde bulundu:', stockItems.length, 'lokasyon');
            
            if (stockItems.length > 0) {
              // Dolu raf bul (hasPallet: true)
              let targetItem = null;
              let targetShelf = null;
              
              for (const item of stockItems) {
                const shelf = newShelfMap[item.Location];
                if (shelf && shelf.hasPallet) {
                  targetItem = item;
                  targetShelf = shelf;
                  console.log('🎯 Dolu raf bulundu - Location:', item.Location);
                  break;
                }
              }
              
              if (targetItem && targetShelf) {
                console.log('✅ Sipariş oluşturuldu! Demand:', nextOrder.Demand_Qty, 'Stock:', targetItem.Stock_Qty);
                
                // Talebi karşıla (stok fazlaysa kalan rafta kalır)
                const pickedQty = Math.min(nextOrder.Demand_Qty, targetItem.Stock_Qty);
                
                ordersRef.current.push({
                  orderId: nextOrder.Material_ID + '_' + Date.now(),
                  materialId: nextOrder.Material_ID,
                  targetLocation: targetItem.Location,
                  targetShelf: targetShelf,
                  quantity: pickedQty,
                  demandQty: nextOrder.Demand_Qty,
                  stockQty: targetItem.Stock_Qty,
                  pickedUp: false,
                  delivered: false
                });
                
                // Talep işleme alındı olarak işaretle
                processedDemandsRef.current.add(nextOrder.Material_ID);
                
                lastOrderTime = Date.now();
              } else {
                console.warn('⚠️ Dolu raf yok (tüm paletler alınmış)');
              }
            } else {
              console.warn('❌ Envanterde stok yok:', nextOrder.Material_ID);
            }
          } else {
            console.log('✓ Tüm siparişler işleme alındı veya tamamlandı');
          }
        }
        
        // Robot hareketleri
        vnaForkliftsRef.current.forEach(vna => {
          if (vna.state === 'idle' && ordersRef.current.length > 0) {
            const corridorOrders = ordersRef.current.filter(o => 
              !o.pickedUp && o.targetShelf.hasPallet
            );
            
            if (corridorOrders.length > 0) {
              const order = corridorOrders[0];
              vna.target = order;
              vna.targetShelf = order.targetShelf;
              vna.busy = true;
              vna.startTime = Date.now();
              vna.state = 'moving_to_shelf';
              vna.hasPallet = false;
              order.pickedUp = true;
              
              // Canlı aktivite ekle
              setLiveActivity(prev => [
                { 
                  robotId: vna.id, 
                  location: order.targetLocation, 
                  status: 'Rafa gidiyor', 
                  startTime: Date.now(),
                  elapsedTime: 0
                },
                ...prev.slice(0, 4)
              ]);
            }
          }

          if (vna.busy && vna.targetShelf) {
            const vnaPos = vna.mesh.position;
            
            if (vna.state === 'moving_to_shelf') {
              const targetPos = vna.targetShelf.position;
              const dx = targetPos.x - vnaPos.x;
              const dz = targetPos.z - vnaPos.z;
              const distance = Math.sqrt(dx * dx + dz * dz);
              const speedMps = config.speedKmPerHour / 3.6; // km/h → m/s
              const speed = speedMps * 0.05; // Frame başına

              if (distance > 0.5) {
                // Önce X (koridor arası), sonra Z (raf içi)
                if (Math.abs(dx) > 0.1) {
                  vna.mesh.position.x += (dx / Math.abs(dx)) * speed;
                  vna.mesh.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
                } else if (Math.abs(dz) > 0.1) {
                  vna.mesh.position.z += (dz / Math.abs(dz)) * speed;
                  vna.mesh.rotation.y = dz > 0 ? 0 : Math.PI;
                }
                
                // Süreyi güncelle
                setLiveActivity(prev => prev.map((act, idx) => 
                  idx === 0 && act.robotId === vna.id 
                    ? { ...act, elapsedTime: ((Date.now() - act.startTime) / 1000).toFixed(1) }
                    : act
                ));
              } else {
                vna.state = 'lifting';
                
                setLiveActivity(prev => prev.map((act, idx) => 
                  idx === 0 && act.robotId === vna.id 
                    ? { ...act, status: 'Palet alınıyor', elapsedTime: ((Date.now() - act.startTime) / 1000).toFixed(1) }
                    : act
                ));
              }
            } else if (vna.state === 'lifting') {
              const targetHeight = vna.targetShelf.y;
              if (vna.forkHeight < targetHeight) {
                vna.forkHeight += 0.08;
                vna.forks.position.y = vna.forkHeight;
              } else {
                vna.hasPallet = true;
                
                if (vna.targetShelf.hasPallet && vna.targetShelf.palletMesh && vna.targetShelf.boxMesh) {
                  vna.carriedPallet = {
                    pallet: vna.targetShelf.palletMesh,
                    box: vna.targetShelf.boxMesh
                  };
                  
                  vna.targetShelf.palletMesh.visible = false;
                  vna.targetShelf.boxMesh.visible = false;
                  vna.targetShelf.hasPallet = false;
                }
                
                vna.state = 'returning_home';
                
                // Status güncelle
                setLiveActivity(prev => prev.map((act, idx) => 
                  idx === 0 && act.robotId === vna.id 
                    ? { ...act, status: 'Başlangıca dönüyor', elapsedTime: ((Date.now() - act.startTime) / 1000).toFixed(1) }
                    : act
                ));
              }
            } else if (vna.state === 'returning_home') {
              const homePos = vna.homePosition;
              const dx = homePos.x - vnaPos.x;
              const dz = homePos.z - vnaPos.z;
              const distance = Math.sqrt(dx * dx + dz * dz);
              const speedMps = config.speedKmPerHour / 3.6;
              const speed = speedMps * 0.05;

              if (distance > 0.5) {
                // Önce Z (raf çıkışı), sonra X (koridor arası)
                if (Math.abs(dz) > 0.1) {
                  vna.mesh.position.z += (dz / Math.abs(dz)) * speed;
                  vna.mesh.rotation.y = dz > 0 ? 0 : Math.PI;
                } else if (Math.abs(dx) > 0.1) {
                  vna.mesh.position.x += (dx / Math.abs(dx)) * speed;
                  vna.mesh.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
                }
                
                // SÜRE GÜNCELLEMESI - DÖNÜŞTE DE ÇALIŞSIN
                setLiveActivity(prev => prev.map((act, idx) => 
                  idx === 0 && act.robotId === vna.id 
                    ? { ...act, elapsedTime: ((Date.now() - act.startTime) / 1000).toFixed(1) }
                    : act
                ));
              } else {
                vna.state = 'lowering';
                
                setLiveActivity(prev => prev.map((act, idx) => 
                  idx === 0 && act.robotId === vna.id 
                    ? { ...act, status: 'Palet bırakılıyor', elapsedTime: ((Date.now() - act.startTime) / 1000).toFixed(1) }
                    : act
                ));
              }
            } else if (vna.state === 'lowering') {
              if (vna.forkHeight > 0) {
                vna.forkHeight -= 0.08;
                vna.forks.position.y = vna.forkHeight;
              } else {
                if (vna.target) {
                  if (vna.carriedPallet) {
                    vna.carriedPallet.pallet.visible = true;
                    vna.carriedPallet.box.visible = true;
                    vna.carriedPallet.pallet.position.copy(new THREE.Vector3(vnaPos.x, 0.1, vnaPos.z));
                    vna.carriedPallet.box.position.copy(new THREE.Vector3(vnaPos.x, 0.5, vnaPos.z));
                    vna.carriedPallet = null;
                  }
                  
                  vna.target.delivered = true;
                  const pickTime = (Date.now() - vna.startTime) / 1000;
                  const palletsInOrder = 1;
                  
                  // Son güncelleme - TAMAMLANDI
                  setLiveActivity(prev => prev.map((act, idx) => 
                    idx === 0 && act.robotId === vna.id 
                      ? { ...act, status: '✓ Tamamlandı', elapsedTime: pickTime.toFixed(1), completed: true }
                      : act
                  ));
                  
                  setMetrics(prev => {
                    const newOrdersProcessed = prev.ordersProcessed + 1;
                    const newTotalTime = prev.totalTime + pickTime;
                    const newAvgPickTime = newTotalTime / newOrdersProcessed;
                    
                    return {
                      ordersProcessed: newOrdersProcessed,
                      avgPickTime: newAvgPickTime,
                      totalTime: newTotalTime,
                      palletsMoved: prev.palletsMoved + palletsInOrder,
                      utilization: Math.min(98, prev.utilization + 1),
                      completedDemands: processedDemandsRef.current.size
                    };
                  });

                  ordersRef.current = ordersRef.current.filter(o => o !== vna.target);
                  vna.target = null;
                  vna.targetShelf = null;
                  vna.busy = false;
                  vna.hasPallet = false;
                  vna.state = 'idle';
                }
              }
            }
          }
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!mountRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, [filesLoaded, config, isRunning, warehouseLayout, inventory, demandOrders]);

  return (
    <div className="w-full h-screen bg-gray-900 flex flex-col">
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 border-b border-gray-700 p-3">
        <h1 className="text-2xl font-bold text-white mb-3">🏭 VNA Depo Simülatörü</h1>
        
        <div className="bg-gray-800 p-3 rounded-lg mb-3 border border-gray-700">
          <h2 className="text-white font-semibold mb-2 text-sm">📁 Excel Dosyaları</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-gray-300 text-xs block mb-1">1. Depo Düzeni</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0], 'layout')}
                className="w-full text-xs file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white"
              />
              {filesLoaded.layout && <span className="text-green-400 text-xs">✓ {warehouseLayout.length} raf</span>}
            </div>
            
            <div>
              <label className="text-gray-300 text-xs block mb-1">2. Envanter</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0], 'inventory')}
                className="w-full text-xs file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white"
              />
              {filesLoaded.inventory && <span className="text-green-400 text-xs">✓ {inventory.length} kayıt</span>}
            </div>
            
            <div>
              <label className="text-gray-300 text-xs block mb-1">3. Talepler</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0], 'demand')}
                className="w-full text-xs file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white"
              />
              {filesLoaded.demand && <span className="text-green-400 text-xs">✓ {demandOrders.length} sipariş</span>}
            </div>
          </div>
        </div>
        
        <div className="bg-gray-800 p-3 rounded-lg mb-3 border border-gray-700">
          <h2 className="text-white font-semibold mb-2 text-sm flex items-center justify-between">
            <span>📊 Sipariş İlerlemesi</span>
            <span className={`text-lg font-bold ${
              metrics.completedDemands === demandOrders.length && demandOrders.length > 0
                ? 'text-green-400' 
                : 'text-blue-400'
            }`}>
              {metrics.completedDemands} / {demandOrders.length}
            </span>
          </h2>
          <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${
                metrics.completedDemands === demandOrders.length && demandOrders.length > 0
                  ? 'bg-green-500' 
                  : 'bg-blue-500'
              }`}
              style={{ 
                width: `${demandOrders.length > 0 ? (metrics.completedDemands / demandOrders.length * 100) : 0}%` 
              }}
            >
              <div className="text-xs text-white font-bold text-center leading-4">
                {demandOrders.length > 0 ? Math.round(metrics.completedDemands / demandOrders.length * 100) : 0}%
              </div>
            </div>
          </div>
          {metrics.completedDemands === demandOrders.length && demandOrders.length > 0 && (
            <div className="mt-2 text-center text-green-400 text-sm font-semibold animate-pulse">
              🎉 Tüm talepler tamamlandı!
            </div>
          )}
        </div>
        
        {/* Canlı Aktivite */}
        <div className="bg-gray-800 p-3 rounded-lg mb-3 border border-gray-700">
          <h2 className="text-white font-semibold mb-2 text-sm">🔴 Canlı Aktivite</h2>
          {liveActivity.length === 0 ? (
            <div className="text-gray-500 text-xs text-center py-2">Henüz aktivite yok</div>
          ) : (
            <div className="space-y-1">
              {liveActivity.map((activity, idx) => (
                <div 
                  key={idx} 
                  className={`flex items-center justify-between p-2 rounded text-xs ${
                    activity.completed 
                      ? 'bg-green-900/30 border border-green-700' 
                      : 'bg-blue-900/30 border border-blue-700 animate-pulse'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">🤖 Robot {activity.robotId}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-mono text-yellow-400">{activity.location}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={activity.completed ? 'text-green-400' : 'text-blue-400'}>
                      {activity.status}
                    </span>
                    <span className="font-mono text-white font-bold">{activity.elapsedTime}s</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-5 gap-2 mb-3">
          <div className="bg-gray-800 p-2 rounded border border-gray-700">
            <div className="flex items-center gap-1 text-blue-400 mb-1">
              <Package size={14} />
              <span className="text-xs">Sipariş</span>
            </div>
            <div className="text-xl font-bold text-white">{metrics.ordersProcessed}</div>
          </div>
          
          <div className="bg-gray-800 p-2 rounded border border-gray-700">
            <div className="flex items-center gap-1 text-green-400 mb-1">
              <Clock size={14} />
              <span className="text-xs">Ort.Süre</span>
            </div>
            <div className="text-xl font-bold text-white">{metrics.avgPickTime.toFixed(1)}s</div>
          </div>
          
          <div className="bg-gray-800 p-2 rounded border border-gray-700">
            <div className="flex items-center gap-1 text-purple-400 mb-1">
              <TrendingUp size={14} />
              <span className="text-xs">Toplam Süre</span>
            </div>
            <div className="text-xl font-bold text-white">
              {metrics.totalTime > 0 ? (metrics.totalTime / 60).toFixed(1) : '0.0'}dk
            </div>
          </div>
          
          <div className="bg-gray-800 p-2 rounded border border-gray-700">
            <div className="flex items-center gap-1 text-orange-400 mb-1">
              <Package size={14} />
              <span className="text-xs">Palet (HU)</span>
            </div>
            <div className="text-xl font-bold text-white">{metrics.palletsMoved}</div>
          </div>
          
          <div className="bg-gray-800 p-2 rounded border border-gray-700">
            <div className="flex items-center gap-1 text-yellow-400 mb-1">
              <Battery size={14} />
              <span className="text-xs">Robot</span>
            </div>
            <div className="text-xl font-bold text-white">{config.vnaCount}</div>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`px-4 py-2 rounded-lg font-semibold ${
              isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
            } text-white`}
          >
            {isRunning ? '⏸ Durdur' : '▶ Başlat'}
          </button>
          
          <button
            onClick={() => {
              setMetrics({ 
                ordersProcessed: 0, 
                avgPickTime: 0, 
                totalTime: 0, 
                palletsMoved: 0, 
                utilization: 0 
              });
              setLiveActivity([]);
              ordersRef.current = [];
            }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold"
          >
            🔄 Sıfırla
          </button>
          
          <div className="flex-1"></div>
          
          <div className="flex gap-2 items-center text-xs text-gray-400">
            <span>Robot:</span>
            <input
              type="number"
              min="1"
              max="6"
              value={config.vnaCount}
              onChange={(e) => setConfig({...config, vnaCount: parseInt(e.target.value) || 1})}
              className="w-16 px-2 py-1 bg-gray-700 text-white rounded border border-gray-600 text-center"
            />
            <span className="ml-3">Hız (km/h):</span>
            <input
              type="number"
              step="0.5"
              min="1"
              max="10"
              value={config.speedKmPerHour}
              onChange={(e) => setConfig({...config, speedKmPerHour: parseFloat(e.target.value) || 3.6})}
              className="w-16 px-2 py-1 bg-gray-700 text-white rounded border border-gray-600 text-center"
            />
          </div>
        </div>
      </div>

      <div ref={mountRef} className="flex-1 cursor-grab active:cursor-grabbing" />

      <div className="bg-gray-800 border-t border-gray-700 p-2 text-center text-xs text-gray-400">
        🖱️ Sürükle: Döndür | Scroll: Zoom | 🤖 Robot FIFO | 📦 Her HU = 1 Palet
      </div>
    </div>
  );
}