interface NAIAnlasDisplayProps {
  token: string
}

export default function NAIAnlasDisplay({ token }: NAIAnlasDisplayProps) {
  const masked = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : 'connected'
  return <div className="text-xs text-muted-foreground">NAI session: {masked}</div>
}
