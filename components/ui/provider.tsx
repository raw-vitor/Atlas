"use client"

import { ChakraProvider } from "@chakra-ui/react"
import { system } from "@/theme/system"
import {
  ColorModeProvider,
  type ColorModeProviderProps,
} from "./color-mode"

// v1: só tema claro (fundo Neve, texto Floresta), como no padrão visual EQI.
export function Provider(props: ColorModeProviderProps) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider forcedTheme="light" {...props} />
    </ChakraProvider>
  )
}
