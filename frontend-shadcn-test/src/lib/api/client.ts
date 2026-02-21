import axios from 'axios'

const configuredBaseUrl = import.meta.env.VITE_BACKEND_URL?.trim()

export const apiClient = axios.create({
  baseURL: configuredBaseUrl && configuredBaseUrl.length > 0 ? configuredBaseUrl : '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})
