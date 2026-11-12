# 06 — Aplicação no Funnelish (rascunho; aguarda inspeção)

Lê as regras comuns. Executa apenas com autorização para operar o editor e acesso autorizado disponível. Recebe especificação validada, media, template nativo identificado e estado de execução. Não construir checkout transacional.

Usa integração suportada se confirmada; caso contrário, Playwright para ações no editor. Não assumir importação HTML, API ou duplicação de templates sem verificação. Identifica controlos reais; não adivinhar coordenadas quando existirem seletores estáveis.

Quando suportado, duplica template em rascunho e preenche secções, textos, imagens/GIFs, estilos e links. Guarda IDs e progresso por secção para retomar sem duplicar páginas. Reutiliza uploads existentes. Não alterar páginas publicadas alheias ao trabalho.

Guarda e reabre para confirmar persistência. Inspeciona resultado real desktop/mobile, textos, imagens, movimento, links e limites de linhas. Corrige falhas específicas; regista bloqueios de login ou editor. Não contornar autenticação nem mudar para API paga.

Entrega URLs/IDs, estado de rascunho/publicação e evidências. Publicar só quando autorizado. Não chamar concluído a um draft não guardado ou a uma página não verificada.
