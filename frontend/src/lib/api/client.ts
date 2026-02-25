import axios from 'axios'

const configuredBaseUrl = import.meta.env.VITE_BACKEND_URL?.trim()
export const API_BASE_URL = configuredBaseUrl && configuredBaseUrl.length > 0 ? configuredBaseUrl : ''

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})
