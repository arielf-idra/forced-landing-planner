import { Ion } from 'cesium'

const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined

if (!token) {
  console.warn(
    'VITE_CESIUM_ION_TOKEN is not set — terrain/imagery will fail to load. See README.md.',
  )
} else {
  Ion.defaultAccessToken = token
}
