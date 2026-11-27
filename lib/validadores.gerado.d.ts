// GERADO por scripts/gerar-validadores.mjs. Não edite à mão.
export interface ErroValidacao { instancePath: string; message?: string }
export interface Validador { (data: unknown): boolean; errors?: ErroValidacao[] | null }
export const AtivosOut: Validador;
export const Lead: Validador;
export const Alocacao: Validador;
export const Diagnostico: Validador;
export const Decisao: Validador;
export const Notas: Validador;
