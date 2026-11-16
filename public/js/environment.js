import * as THREE from 'three';

const LATITUDE = 20.702986;
const LONGITUDE = 106.36364;
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const REFRESH_MS = 15 * 60_000;
const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&current=temperature_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m&timezone=${TIME_ZONE}`;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function description(code) {
  if (code === 0) return 'Trời quang';
  if (code === 1) return 'Ít mây';
  if (code === 2) return 'Mây rải rác';
  if (code === 3) return 'Nhiều mây';
  if (code === 45 || code === 48) return 'Sương mù';
  if (code >= 51 && code <= 57) return 'Mưa phùn';
  if (code >= 61 && code <= 67) return 'Mưa';
  if (code >= 71 && code <= 77) return 'Tuyết';
  if (code >= 80 && code <= 82) return 'Mưa rào';
  if (code === 85 || code === 86) return 'Mưa tuyết';
  if (code >= 95) return 'Dông';
  return 'Thời tiết thay đổi';
}

function precipitationType(code) {
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'none';
}

function localClock(epoch, offsetSeconds) {
  const date = new Date(epoch + offsetSeconds * 1000);
  const year = date.getUTCFullYear();
  const day = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 0)) / 86_400_000);
  return {
    hour: date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600,
    day,
  };
}

function solarDirection(epoch, offsetSeconds) {
  const { hour, day } = localClock(epoch, offsetSeconds);
  const latitude = LATITUDE * Math.PI / 180;
  const declination = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + day) / 365);
  const hourAngle = (hour - 12) * Math.PI / 12;
  const sinElevation = Math.sin(latitude) * Math.sin(declination)
    + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  return {
    x: -Math.cos(declination) * Math.sin(hourAngle),
    y: sinElevation,
    z: Math.cos(latitude) * Math.sin(declination)
      - Math.sin(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  };
}

function createRain(scene, count) {
  const drops = Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 70,
    y: 1 + Math.random() * 32,
    z: (Math.random() - 0.5) * 70,
  }));
  const positions = new Float32Array(count * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xb9d7ed, transparent: true, opacity: 0.42, depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  scene.add(lines);
  return { drops, positions, geometry, material, lines };
}

function createSnow(scene, count) {
  const flakes = Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 70,
    y: 1 + Math.random() * 32,
    z: (Math.random() - 0.5) * 70,
  }));
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xe9f3ff, size: 0.16, transparent: true, opacity: 0.8, depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return { flakes, positions, geometry, points };
}

export function createEnvironment({ scene, camera, sky, clouds, cloudMaterial, hemisphere, sun, renderer, status, lamps = [] }) {
  const rain = createRain(scene, 360);
  const snow = createSnow(scene, 220);
  const topDay = new THREE.Color();
  const bottomDay = new THREE.Color();
  const skyTop = new THREE.Color();
  const skyBottom = new THREE.Color();
  const fogColor = new THREE.Color();
  const cloudColor = new THREE.Color();
  const nightTop = new THREE.Color(0x071325);
  const nightBottom = new THREE.Color(0x1b2b40);
  const fogDay = new THREE.Color(0xd6e7f3);
  const fogNight = new THREE.Color(0x111a2b);
  const clearTop = new THREE.Color(0x3b8be0);
  const cloudyTop = new THREE.Color(0x748391);
  const clearBottom = new THREE.Color(0xe4eef5);
  const cloudyBottom = new THREE.Color(0xb7c0c7);
  const clearCloud = new THREE.Color(0xffffff);
  const stormCloud = new THREE.Color(0x747e88);
  const nightCloud = new THREE.Color(0x303a4b);
  const coolSun = new THREE.Color(0xfff0d8);
  const warmSun = new THREE.Color(0xff9a5a);
  const hemisphereDay = new THREE.Color(0xdfefff);
  const hemisphereNight = new THREE.Color(0x34445e);
  const groundDay = new THREE.Color(0x7a6a4a);
  const groundNight = new THREE.Color(0x202838);
  const lampMaterials = new Set(lamps.map(lamp => lamp.bulb));
  const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit',
  });

  const now = Date.now();
  const fallbackHour = localClock(now, 7 * 3600).hour;
  const state = {
    loaded: false,
    error: null,
    weatherCode: null,
    temperature: null,
    cloudCover: 0,
    precipitation: 0,
    windSpeed: 0,
    isDay: fallbackHour >= 6 && fallbackHour < 18,
    updatedAt: '',
    offsetSeconds: 7 * 3600,
  };
  let minuteShown = -1;
  let requestActive = false;

  function renderStatus(epoch) {
    if (!status) return;
    const time = timeFormatter.format(new Date(epoch));
    if (!state.loaded) {
      status.textContent = `Ninh Giang · ${time} · ${state.error ? 'Chưa tải được thời tiết' : 'Đang đồng bộ thời tiết…'}`;
      status.title = state.error
        ? 'Không kết nối được Open-Meteo; quang cảnh vẫn theo giờ Việt Nam trên thiết bị.'
        : 'Đang lấy thời tiết hiện tại tại Ninh Giang từ Open-Meteo.';
      return;
    }
    status.textContent = `Ninh Giang · ${time} · ${description(state.weatherCode)} · ${Math.round(state.temperature)}°C · Open-Meteo`;
    status.title = `Nguồn: Open-Meteo · Dữ liệu thời tiết gần nhất: ${state.updatedAt}${state.error ? ' · Mất kết nối, đang dùng dữ liệu gần nhất' : ''}`;
  }

  async function syncWeather() {
    if (requestActive) return;
    requestActive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(WEATHER_URL, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
      const data = await response.json();
      const current = data?.current;
      if (data?.timezone !== TIME_ZONE
        || !current
        || typeof current.time !== 'string'
        || !Number.isFinite(current.temperature_2m)
        || !Number.isFinite(current.weather_code)
        || !Number.isFinite(current.cloud_cover)
        || !Number.isFinite(current.precipitation)
        || !Number.isFinite(current.wind_speed_10m)
        || (current.is_day !== 0 && current.is_day !== 1)
        || !Number.isFinite(data.utc_offset_seconds)) {
        throw new Error('Open-Meteo returned incomplete current conditions');
      }
      state.loaded = true;
      state.error = null;
      state.weatherCode = Math.round(current.weather_code);
      state.temperature = current.temperature_2m;
      state.cloudCover = clamp(current.cloud_cover, 0, 100);
      state.precipitation = Math.max(0, current.precipitation);
      state.windSpeed = Math.max(0, current.wind_speed_10m);
      state.isDay = current.is_day === 1;
      state.updatedAt = current.time;
      state.offsetSeconds = data.utc_offset_seconds;
    } catch (error) {
      state.error = error;
      console.error('Weather sync for THPT Ninh Giang failed:', error);
    } finally {
      clearTimeout(timeout);
      requestActive = false;
      renderStatus(Date.now());
    }
  }

  const starsGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(360 * 3);
  for (let i = 0; i < 360; i++) {
    const azimuth = Math.random() * Math.PI * 2;
    const height = 0.12 + Math.random() * 0.88;
    const radius = Math.sqrt(1 - height * height);
    starPositions[i * 3] = Math.cos(azimuth) * radius * 560;
    starPositions[i * 3 + 1] = height * 560;
    starPositions[i * 3 + 2] = Math.sin(azimuth) * radius * 560;
  }
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xe1eaff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starsGeometry, starMaterial);
  stars.frustumCulled = false;
  stars.visible = false;
  scene.add(stars);

  function update(dt, elapsed, targetX, targetZ) {
    const epoch = Date.now();
    const solar = solarDirection(epoch, state.offsetSeconds);
    const daylight = state.isDay ? clamp((solar.y + 0.03) / 0.48, 0, 1) : 0;
    const cloud = state.cloudCover / 100;
    const mode = precipitationType(state.weatherCode);
    const dimming = (1 - cloud * 0.55) * (mode === 'rain' ? 0.78 : 1);
    const sunriseWarmth = clamp((0.42 - solar.y) / 0.34, 0, 1);

    topDay.copy(clearTop).lerp(cloudyTop, cloud * 0.75);
    bottomDay.copy(clearBottom).lerp(cloudyBottom, cloud * 0.7);
    skyTop.copy(nightTop).lerp(topDay, daylight);
    skyBottom.copy(nightBottom).lerp(bottomDay, daylight);
    sky.material.uniforms.top.value.copy(skyTop);
    sky.material.uniforms.bottom.value.copy(skyBottom);
    fogColor.copy(fogNight).lerp(fogDay, daylight);
    scene.fog.color.copy(fogColor);
    const foggy = state.weatherCode === 45 || state.weatherCode === 48;
    scene.fog.near = foggy ? 28 : 90;
    scene.fog.far = Math.max(90, 320 - cloud * 95 - (mode === 'rain' ? 55 : 0) - (foggy ? 110 : 0));

    hemisphere.color.copy(hemisphereNight).lerp(hemisphereDay, daylight);
    hemisphere.groundColor.copy(groundNight).lerp(groundDay, daylight);
    hemisphere.intensity = 0.36 + 0.79 * daylight * (1 - cloud * 0.2);
    sun.color.copy(warmSun).lerp(coolSun, 1 - sunriseWarmth);
    sun.intensity = 2.7 * daylight * dimming;
    sun.target.position.set(targetX, 0, targetZ);
    sun.position.set(
      targetX + solar.x * 80,
      Math.max(0.08, solar.y) * 80,
      targetZ + solar.z * 80,
    );
    const lampLevel = clamp((0.38 - daylight) / 0.38, 0, 1);
    for (const lamp of lamps) lamp.light.intensity = lamp.maxIntensity * lampLevel;
    for (const material of lampMaterials) material.emissiveIntensity = 0.02 + lampLevel * 0.95;
    renderer.toneMappingExposure = 0.72 + 0.28 * daylight;

    cloudColor.copy(clearCloud).lerp(stormCloud, Math.max(cloud * 0.8, mode === 'rain' ? 0.75 : 0));
    cloudMaterial.color.copy(nightCloud).lerp(cloudColor, daylight);
    cloudMaterial.emissiveIntensity = 0.05 + daylight * 0.4;
    clouds.visible = cloud > 0.12 || foggy || mode === 'rain';
    clouds.scale.setScalar(0.65 + cloud * 0.4);
    clouds.position.set(camera.position.x, 0, camera.position.z);
    clouds.rotation.y = elapsed * 0.004;
    sky.position.copy(camera.position);

    stars.visible = !state.isDay && cloud < 0.68 && !foggy;
    stars.position.copy(camera.position);
    starMaterial.opacity = 0.85 * (1 - cloud);

    rain.lines.visible = mode === 'rain';
    if (mode === 'rain') {
      rain.lines.position.set(camera.position.x, 0, camera.position.z);
      rain.material.opacity = clamp(0.2 + state.precipitation * 0.08, 0.2, 0.58);
      const rainPositions = rain.positions;
      for (let i = 0; i < rain.drops.length; i++) {
        const drop = rain.drops[i];
        drop.y -= dt * (18 + state.windSpeed * 0.18);
        drop.x += dt * state.windSpeed * 0.015;
        if (drop.y < 0) {
          drop.x = (Math.random() - 0.5) * 70;
          drop.y = 25 + Math.random() * 12;
          drop.z = (Math.random() - 0.5) * 70;
        }
        const p = i * 6;
        rainPositions[p] = drop.x;
        rainPositions[p + 1] = drop.y;
        rainPositions[p + 2] = drop.z;
        rainPositions[p + 3] = drop.x + 0.12;
        rainPositions[p + 4] = drop.y - 0.7;
        rainPositions[p + 5] = drop.z;
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }

    snow.points.visible = mode === 'snow';
    if (mode === 'snow') {
      snow.points.position.set(camera.position.x, 0, camera.position.z);
      for (let i = 0; i < snow.flakes.length; i++) {
        const flake = snow.flakes[i];
        flake.y -= dt * 1.4;
        flake.x += Math.sin(elapsed + i) * dt * 0.6;
        if (flake.y < 0) {
          flake.x = (Math.random() - 0.5) * 70;
          flake.y = 25 + Math.random() * 12;
          flake.z = (Math.random() - 0.5) * 70;
        }
        const p = i * 3;
        snow.positions[p] = flake.x;
        snow.positions[p + 1] = flake.y;
        snow.positions[p + 2] = flake.z;
      }
      snow.geometry.attributes.position.needsUpdate = true;
    }

    const minute = Math.floor(epoch / 60_000);
    if (minute !== minuteShown) {
      minuteShown = minute;
      renderStatus(epoch);
    }
  }

  renderStatus(now);
  syncWeather();
  setInterval(syncWeather, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncWeather();
  });
  return {
    update,
    getLocalHour: () => localClock(Date.now(), state.offsetSeconds).hour,
  };
}
