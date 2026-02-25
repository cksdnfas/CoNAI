import { useState } from 'react'
import { Fragment } from 'react'
import NAILoginForm from '../nai/components/nai-login-form'
import NAIImageGeneratorV2 from '../nai/components/nai-image-generator-v2'

export default function NAITab() {
  const [token, setToken] = useState<string | null>(() => {
    const savedToken = localStorage.getItem('nai_token')
    const expiresAt = localStorage.getItem('nai_token_expires')

    if (savedToken && expiresAt) {
      const valid = new Date(expiresAt) > new Date()
      if (valid) {
        return savedToken
      }

      localStorage.removeItem('nai_token')
      localStorage.removeItem('nai_token_expires')
    }

    return null
  })
  const [isTokenValid, setIsTokenValid] = useState(Boolean(token))

  const handleLoginSuccess = (accessToken: string) => {
    setToken(accessToken)
    setIsTokenValid(true)
  }

  const handleLogout = () => {
    localStorage.removeItem('nai_token')
    localStorage.removeItem('nai_token_expires')
    setToken(null)
    setIsTokenValid(false)
  }

  if (!isTokenValid) {
    return <NAILoginForm onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <Fragment><NAIImageGeneratorV2 token={token || ''} onLogout={handleLogout} /></Fragment>
  )
}
