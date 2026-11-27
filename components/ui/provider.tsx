"use client"

import createCache from "@emotion/cache"
import { CacheProvider } from "@emotion/react"
import { ChakraProvider } from "@chakra-ui/react"
import { useServerInsertedHTML } from "next/navigation"
import { useState, type ReactNode } from "react"
import { system } from "@/theme/system"

// Registro do Emotion para o App Router: o CSS do servidor sai pelo useServerInsertedHTML, e não como <style> solto
// dentro do <body>, que não bate com o que o cliente renderiza (erro de hidratação #418).
// Padrão da documentação do Emotion para o Next.js.
function useRegistroEmotion() {
  return useState(() => {
    const cache = createCache({ key: "css" })
    cache.compat = true
    const inserirOriginal = cache.insert
    let inseridos: string[] = []
    cache.insert = (...args) => {
      const serializado = args[1]
      if (cache.inserted[serializado.name] === undefined) inseridos.push(serializado.name)
      return inserirOriginal(...args)
    }
    const esvaziar = () => {
      const nomes = inseridos
      inseridos = []
      return nomes
    }
    return { cache, esvaziar }
  })[0]
}

// v1: só tema claro (fundo Neve, texto Floresta), como no padrão visual EQI.
// Sem next-themes: o script inline dele quebra no bundle do Worker (esbuild injeta `__name`).
// A classe "light" fica fixa no <html> (layout.tsx).
export function Provider({ children }: { children: ReactNode }) {
  const { cache, esvaziar } = useRegistroEmotion()
  useServerInsertedHTML(() => {
    const nomes = esvaziar()
    if (nomes.length === 0) return null
    let estilos = ""
    for (const nome of nomes) estilos += cache.inserted[nome]
    return <style key={cache.key} data-emotion={`${cache.key} ${nomes.join(" ")}`} dangerouslySetInnerHTML={{ __html: estilos }} />
  })
  return (
    <CacheProvider value={cache}>
      <ChakraProvider value={system}>{children}</ChakraProvider>
    </CacheProvider>
  )
}
