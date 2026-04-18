#!/usr/bin/env python3
"""
Скрипт для добавления новых секций в DEVELOPMENT_PLAN.md
"""

def read_file(filepath):
    """Читает файл и возвращает список строк"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.readlines()
    except Exception as e:
        print(f"Error reading file: {e}")
        return None

def find_insert_position(lines):
    """Находит позицию для вставки после строки 1482"""
    # Ищем строку "1482|---"
    for i, line in enumerate(lines):
        if line.startswith("1482|---"):
            return i + 1  # Вставить после этой строки
    return None

def new_sections_content():
    """Возвращает содержимое новых секций"""
    sections = []
    
    sections.append("---")
    
    sections.append("## Frontend RBAC baseline\n")
    sections.append("")
    sections.append("Матрица минимальных ролей и защищённых действий для operator UI.")
    sections.append("")
    sections.append("| Route | Minimum role | Protected actions (require approval) |")
    sections.append("|-------|---------------|---------------------------------------|")
    sections.append("| /dashboard | viewer | none (read-only) |")
    sections.append("| /portfolio | operator | none (read-only) |")
    sections.append("| /opportunities | viewer | none (read-only) |")
    sections.append("| /execution | operator | force hedge/unwind (two-step approval required) |")
    sections.append("| /tokens | operator | promote to live (two-step approval required) |")
    sections.append("| /paper | operator | approve/reject trade (single-step approval) |")
    sections.append("| /incidents | operator | mark resolved (two-step approval required) |")
    sections.append("| /runbooks | operator | run playbook (two-step approval required) |")
    sections.append("| /openclaw | operator | all actions (two-step approval required) |")
    sections.append("| /settings | operator | sensitive settings (two-step approval required) |")
    sections.append("")
    sections.append("**Role hierarchy:** `viewer` < `operator` < `admin` (future)")
    sections.append("")
    sections.append("**RBAC enforcement:**")
    sections.append("- Middleware `/api/operator/*` проверяет роль (см. `apps/web/middleware.ts`, `lib/operator-role.ts`)")
    sections.append("- На фронте: disabled buttons/actions для недоступных ролей")
    sections.append("- Approval flow реализуется на backend как отдельный endpoint с double-check")
    
    sections.append("")
    sections.append("---")
    
    sections.append("## Operator Safety UI Patterns")
    sections.append("")
    sections.append("Требования к UI для опасных действий оператора.")
    sections.append("")
    sections.append("### Destructive actions checklist")
    sections.append("")
    sections.append("Для всех действий с риском капитала или состояния системы:")
    sections.append("")
    sections.append("1. **Confirmation dialogs:**")
    sections.append("   - Single-step confirmation для medium-risk (кнопка \"Cancel\" / \"Confirm\")")
    sections.append("   - Two-step confirmation для high-risk (preview → explicit warning → confirm)")
    sections.append("")
    sections.append("2. **Impact preview (high-risk только):**")
    sections.append("   - Read-only summary того, что изменится")
    sections.append("   - Какие планы/позиции/токены затронуты")
    sections.append("   - Оценка рисков и потенциальных последствий")
    sections.append("   - Ссылки на связанные runbooks (если применимо)")
    sections.append("")
    sections.append("3. **Operation status tracking:**")
    sections.append("   - Pending → Running → Success / Failure")
    sections.append("   - Визуальный индикатор для async операций")
    sections.append("   - Таймаут и автоматический переход в Failure при stall")
    sections.append("")
    sections.append("4. **Audit trail:**")
    sections.append("   - Каждое действие записывается в audit log")
    sections.append("   - Отображение истории действий в UI (кто/когда/что)")
    sections.append("   - Возможность отслеживания по correlation ID")
    sections.append("")
    sections.append("### Error handling patterns")
    sections.append("")
    sections.append("1. **Секции independent error states:** (уже реализовано в Phase 3)")
    sections.append("   - Каждая секция имеет свой error boundary")
    sections.append("   - Partial failures не блокируют весь UI")
    sections.append("")
    sections.append("2. **Network errors vs API errors:**")
    sections.append("   - Дифференциация 4xx (validation/permission) vs 5xx (server)")
    sections.append("   - Явное сообщение оператору о повторной попытке или необходимости контакта с support")
    sections.append("")
    sections.append("3. **Rollback UX:**")
    sections.append("   - При optimistic update failure — явный rollback в UI")
    sections.append("   - Возможность retry для transient errors")
    sections.append("   - Immutable audit log даже при rollback")
    
    sections.append("")
    sections.append("---")
    
    sections.append("## Frontend Non-Functional Requirements")
    sections.append("")
    sections.append("### Frontend Performance Baseline")
    sections.append("")
    sections.append("- **TanStack Table virtualization:** для списков > 1000 строк")
    sections.append("- **First Meaningful Paint (FMP):** < 1.5s на /dashboard")
    sections.append("- **Initial paint:** < 1s для всех маршрутов")
    sections.append("- **Large table rendering:** pagination или virtualization (минимум 100 строк на viewport)")
    sections.append("")
    sections.append("### Frontend Accessibility Baseline")
    sections.append("")
    sections.append("- **Keyboard navigation:** все интерактивные элементы доступны с клавиатуры")
    sections.append("- **ARIA labels:** для всех кнопок и status indicators")
    sections.append("- **Color contrast:** WCAG AA compliance")
    sections.append("- **Screen reader test:** ключевые маршруты протестированы")
    sections.append("")
    sections.append("### Frontend Responsive Design Baseline")
    sections.append("")
    sections.append("- **Breakpoints:**")
    sections.append("  - mobile: < 768px")
    sections.append("  - tablet: 768-1024px")
    sections.append("  - desktop: > 1024px")
    sections.append("- **Tables:** scrollable на mobile, full-width на desktop")
    sections.append("- **Navigation:** collapsible hamburger на mobile")
    sections.append("")
    sections.append("### Frontend Data Freshness Strategy")
    sections.append("")
    sections.append("- **Real-time routes:** /execution, /incidents — polling (30s) или SSE")
    sections.append("- **Stale data strategy:**")
    sections.append("  - `staleTime` и `refetchInterval` задокументированы для каждого query")
    sections.append("  - Manual refresh кнопки на всех read-only списках")
    sections.append("  - Auto-invalidation при мутациях (React Query `invalidateQueries`)")
    
    return ''.join(sections)

def main():
    filepath = r"c:\Users\kazak\Documents\Cursor\Arbibot 2\.cursor\plans\DEVELOPMENT_PLAN.md"
    
    # Читаем файл
    lines = read_file(filepath)
    if lines is None:
        return
    
    # Находим позицию для вставки
    insert_pos = find_insert_position(lines)
    if insert_pos is None:
        print(f"Error: Could not find insert position '1482|---'")
        return
    
    # Получаем новые секции
    new_content = new_sections_content()
    
    # Вставляем новые секции
    lines[insert_pos:insert_pos] = new_content
    
    # Записываем обратно
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        print(f"Success: Inserted new sections at line {insert_pos}")
    except Exception as e:
        print(f"Error writing file: {e}")

if __name__ == "__main__":
    main()
