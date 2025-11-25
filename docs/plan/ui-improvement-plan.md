# UI/UX 개선 계획

> 프론트엔드 전체 페이지 및 모달 분석 결과를 바탕으로 작성된 개선 계획서

## 목차
1. [개요](#개요)
2. [Phase 1: 설명 텍스트 최적화](#phase-1-설명-텍스트-최적화)
3. [Phase 2: 여백 및 간격 통일](#phase-2-여백-및-간격-통일)
4. [Phase 3: 컴포넌트 스타일 일관성](#phase-3-컴포넌트-스타일-일관성)
5. [Phase 4: 공통 컴포넌트 리팩토링](#phase-4-공통-컴포넌트-리팩토링)
6. [상세 개선 항목](#상세-개선-항목)

---

## 개요

### 분석 대상
- Settings 페이지 (GeneralSettings, FolderSettings, TaggerSettings 등)
- Images/Gallery 페이지 및 관련 모달
- Prompts, Groups, Wildcards, Workflows 페이지
- 공통 컴포넌트 (SearchBar, FilterBuilder, ImageViewerModal 등)

### 핵심 문제점
1. **과도한 설명 텍스트**: 사용자 인터페이스를 압도하는 장황한 설명
2. **불일치하는 여백**: 타이틀-입력박스 간격, 섹션 간 여백이 페이지마다 다름
3. **스타일 불일치**: Tooltip, Alert, Button 등의 사용 패턴이 통일되지 않음

---

## Phase 1: 설명 텍스트 최적화

### 목표
불필요한 설명 텍스트를 제거하거나 Tooltip으로 전환하여 UI 간결화

### 작업 항목

#### 1.1 Settings 페이지 - Stealth PNG 설명 (높은 우선순위)
| 파일 | 현재 상태 | 개선 방향 |
|------|-----------|-----------|
| `frontend/src/pages/Settings/features/Similarity/SimilaritySettings.tsx` | 파일 크기/해상도 제한 아래 설명 텍스트 표시 | Tooltip으로 전환 |

**변경 예시:**
```tsx
// Before
<TextField label="최대 파일 크기 (MB)" ... />
<Typography variant="caption" color="text.secondary">
  이 크기보다 큰 파일은 Stealth PNG 스캔을 건너뜁니다
</Typography>

// After
<TextField
  label="최대 파일 크기 (MB)"
  InputProps={{
    endAdornment: (
      <Tooltip title="이 크기보다 큰 파일은 Stealth PNG 스캔을 건너뜁니다">
        <InfoOutlinedIcon fontSize="small" />
      </Tooltip>
    )
  }}
/>
```

#### 1.2 기타 Settings 설명 텍스트
| 파일 | 위치 | 개선 방향 |
|------|------|-----------|
| `GeneralSettings.tsx` | Tagger 설명 (line 108-110) | Tooltip |
| `GeneralSettings.tsx` | Rating 설명 (line 50-51) | Tooltip |
| `GeneralSettings.tsx` | Similarity 설명 (line 58-59) | Tooltip |
| `TaggerSettings.tsx` | 섹션 설명 텍스트 (line 104-107) | 축약 또는 제거 |
| `FolderSettings.tsx` | 스케줄러 설명 | Tooltip |

#### 1.3 모달 및 Dialog 설명 텍스트
| 파일 | 위치 | 개선 방향 |
|------|------|-----------|
| `CivitaiUploadModal.tsx` | 업로드 방식 설명 (line 218-223) | Tooltip |
| `CivitaiUploadModal.tsx` | 메타데이터 체크박스 설명 (line 282-284) | Tooltip |
| `FilterBlockModal.tsx` | 점수 범위 설명 (line 287-289) | 라벨에 통합 |
| `WildcardTab.tsx` | ComfyUI/NovelAI 탭 내 Alert (line 460, 493) | 상단 1회 표시 |

#### 1.4 페이지 헤더 설명 최적화
| 파일 | 현재 상태 | 개선 방향 |
|------|-----------|-----------|
| `UploadPage.tsx` | 타이틀 아래 긴 description | 1줄로 축약 |
| `GalleryPage.tsx` | 타이틀 아래 긴 description | 1줄로 축약 |
| `SearchPage.tsx` | 타이틀 아래 긴 description | 1줄로 축약 |

---

## Phase 2: 여백 및 간격 통일

### 목표
일관된 여백 시스템 적용으로 깔끔한 레이아웃 구현

### 2.1 여백 표준 정의

```tsx
// 권장 여백 기준 (theme.spacing 단위)
const spacingStandard = {
  // 섹션 타이틀 아래
  sectionTitleBottom: 2,      // 16px

  // 섹션 간 구분
  sectionGap: 3,              // 24px

  // 입력 필드 간
  fieldGap: 2,                // 16px

  // Paper/Card 내부 패딩
  cardPadding: 3,             // 24px

  // Dialog 내부 간격
  dialogContentGap: 2,        // 16px

  // Divider 여백
  dividerMargin: 2.5,         // 20px
};
```

### 2.2 타이틀-입력박스 간격 수정
| 파일 | 현재 상태 | 개선 방향 |
|------|-----------|-----------|
| `SearchPage.tsx` | 헤더 mb:2-3 + 검색바 mb:2-3 (총 32-48px) | 통합하여 mb:2 |
| `GalleryPage.tsx` | 헤더 mb:2-3 + Paper mb:2-3 | 통합하여 mb:2 |
| `WeightConfiguration.tsx` | gutterBottom + spacing:3 중복 | spacing:2로 통일 |
| `SimilarityThresholds.tsx` | Typography mb:1 + Stack spacing:3 | spacing:2로 통일 |

### 2.3 Divider 여백 통일
| 파일 | 현재 상태 | 개선 방향 |
|------|-----------|-----------|
| `GeneralSettings.tsx` | my:4 (32px) | my:3 (24px)로 통일 |
| `ExternalApiSettings.tsx` | my:2 (16px) | my:3 (24px)로 통일 |
| 모든 Settings 파일 | 불일치 | my:3으로 통일 |

### 2.4 Dialog 내부 구조 표준화
```tsx
// 표준 Dialog 구조
<Dialog maxWidth="md" fullWidth>
  <DialogTitle>제목</DialogTitle>
  <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
    {/* 필드들 */}
  </DialogContent>
  <DialogActions>
    <Button>{t('common:cancel')}</Button>
    <Button variant="contained">{t('common:save')}</Button>
  </DialogActions>
</Dialog>
```

### 2.5 반응형 여백 개선
```tsx
// 현재 (급격한 변화)
sx={{ mb: { xs: 2, sm: 3 } }}  // 16px -> 24px

// 개선 (부드러운 변화)
sx={{ mb: { xs: 1.5, sm: 2, md: 3 } }}  // 12px -> 16px -> 24px
```

---

## Phase 3: 컴포넌트 스타일 일관성

### 3.1 Tooltip 스타일 통일
| 현재 패턴 | 파일 예시 | 통일 방향 |
|-----------|-----------|-----------|
| InfoIcon + ml:1 | GeneralSettings.tsx | 표준 패턴으로 통일 |
| IconButton > InfoIcon | FolderSettings.tsx | 표준 패턴으로 통일 |
| cursor:help | TaggerConfigForm.tsx | 표준 패턴으로 통일 |

**표준 패턴:**
```tsx
<Tooltip title={tooltipText} arrow placement="top">
  <InfoOutlinedIcon
    fontSize="small"
    sx={{ ml: 1, color: 'text.secondary', cursor: 'help' }}
  />
</Tooltip>
```

### 3.2 Alert 사용 통일
| 현재 패턴 | 파일 예시 | 개선 방향 |
|-----------|-----------|-----------|
| Box + Typography | SearchBar.tsx | Alert 컴포넌트 사용 |
| Alert severity="info" | AuthSettings.tsx | 유지 |
| Alert severity="error" | GeneralSettings.tsx | 유지 |

**통일 규칙:**
- 모든 에러/경고 메시지는 `<Alert>` 컴포넌트 사용
- Alert 하단 여백: `mb: 2`로 통일

### 3.3 Button 스타일 통일
| 용도 | variant | size | 추가 속성 |
|------|---------|------|-----------|
| Primary Action | contained | medium | color="primary" |
| Secondary Action | outlined | medium | - |
| Destructive Action | contained | medium | color="error" |
| Icon Button | - | small | - |

### 3.4 Card/Paper 여백 통일
```tsx
// 표준 Card 스타일
<Card sx={{ mb: 3 }}>
  <CardContent sx={{ p: 3 }}>
    {/* 내용 */}
  </CardContent>
</Card>

// 표준 Paper 스타일
<Paper sx={{ p: 3, mb: 3 }}>
  {/* 내용 */}
</Paper>
```

---

## Phase 4: 공통 컴포넌트 리팩토링

### 4.1 InfoTooltip 컴포넌트 생성
```tsx
// frontend/src/components/common/InfoTooltip.tsx
interface InfoTooltipProps {
  title: string;
  placement?: 'top' | 'right' | 'bottom' | 'left';
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  title,
  placement = 'top'
}) => (
  <Tooltip title={title} arrow placement={placement}>
    <InfoOutlinedIcon
      fontSize="small"
      sx={{ ml: 1, color: 'text.secondary', cursor: 'help' }}
    />
  </Tooltip>
);
```

### 4.2 PageHeader 컴포넌트 생성
```tsx
// frontend/src/components/common/PageHeader.tsx
interface PageHeaderProps {
  title: string;
  description?: string;
  tooltip?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  tooltip
}) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="h4" component="h1">
        {title}
      </Typography>
      {tooltip && <InfoTooltip title={tooltip} />}
    </Box>
    {description && (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {description}
      </Typography>
    )}
  </Box>
);
```

### 4.3 SectionHeader 컴포넌트 생성
```tsx
// frontend/src/components/common/SectionHeader.tsx
interface SectionHeaderProps {
  title: string;
  tooltip?: string;
  divider?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  tooltip,
  divider = true
}) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="h6">{title}</Typography>
      {tooltip && <InfoTooltip title={tooltip} />}
    </Box>
    {divider && <Divider sx={{ mt: 1 }} />}
  </Box>
);
```

### 4.4 FormField 래퍼 컴포넌트
```tsx
// frontend/src/components/common/FormField.tsx
interface FormFieldProps {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  tooltip,
  children
}) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
      <Typography variant="subtitle2">{label}</Typography>
      {tooltip && <InfoTooltip title={tooltip} />}
    </Box>
    {children}
  </Box>
);
```

---

## 상세 개선 항목

### Settings 페이지

#### GeneralSettings.tsx
| 라인 | 문제 | 개선 |
|------|------|------|
| 287 | Divider my:4 과도 | my:3으로 변경 |
| 345 | Divider my:4 과도 | my:3으로 변경 |
| 144-161 | Select 레이블 간격 | margin="normal" 추가 |
| 225-250 | Switch 수직 정렬 | alignItems 확인 |

#### FolderSettings.tsx
| 라인 | 문제 | 개선 |
|------|------|------|
| 116-128 | Tooltip 스타일 불일치 | 표준 패턴 적용 |
| 144-152 | TextField 고정 너비 200px | 반응형으로 변경 |

#### AuthSettings.tsx
| 라인 | 문제 | 개선 |
|------|------|------|
| 155-182 | TextField mb:2, mb:3 불일치 | Stack 사용으로 통일 |
| 151-153 | Alert mb:3 | mb:2로 통일 |

### Images/Gallery 페이지

#### ImageViewerModal.tsx
| 라인 | 문제 | 개선 |
|------|------|------|
| 488-497 | Bottom bar py:1 좁음 | py:1.5로 변경 |
| 245-258 | Box로 에러 표시 | Alert 컴포넌트 사용 |

#### AIInfoSection.tsx & FileInfoSection.tsx
| 문제 | 개선 |
|------|------|
| Collapse 초기값 불일치 | false로 통일 |
| 타이틀 아래 mb:1 좁음 | mb:1.5로 변경 |

### Prompts/Groups/Wildcards/Workflows 페이지

#### WildcardTab.tsx
| 라인 | 문제 | 개선 |
|------|------|------|
| 460, 493 | 중복 Alert | 상단 1회 표시 |
| 454-460 | 타이틀-Alert 간격 부족 | mb:2 추가 |

#### WorkflowFormPage.tsx
| 라인 | 문제 | 개선 |
|------|------|------|
| 277-279 | 타이틀-Divider 간격 | mb:2 추가 |
| 504-520 | 버튼 그룹 위 여백 부족 | mt:4 추가 |

#### PromptList.tsx
| 라인 | 문제 | 개선 |
|------|------|------|
| 335 | "취소" 하드코딩 | 번역 키 사용 |
| 316 | 선택 UI mb:2 부족 | mb:3으로 변경 |

### 공통 컴포넌트

#### SearchBar.tsx
| 문제 | 개선 |
|------|------|
| 에러 Box+Typography | Alert 컴포넌트 사용 |
| 반응형 미적용 | breakpoint 추가 |

#### FilterBlockList.tsx
| 문제 | 개선 |
|------|------|
| Animation 과도 | 제거 또는 간소화 |
| CSS keyframes 중복 | 하나로 통합 |

#### PromptDisplay.tsx
| 문제 | 개선 |
|------|------|
| Scrollbar 스타일 하드코딩 | 전역 스타일로 이동 |
| maxHeight 불일치 (200/150/400) | 250으로 통일 |

---

## 우선순위 및 일정

### 높은 우선순위 (즉시 개선)
1. Settings 페이지 Stealth PNG 설명 → Tooltip 전환
2. Divider 여백 통일 (my:3)
3. Dialog 내부 간격 표준화

### 중간 우선순위
1. 설명 텍스트 Tooltip 전환 (나머지)
2. Card/Paper 스타일 통일
3. Alert 사용 통일

### 낮은 우선순위 (미래 리팩토링)
1. 공통 컴포넌트 생성 (InfoTooltip, PageHeader 등)
2. 디자인 토큰 정립
3. 접근성 개선

---

## 체크리스트

### Phase 1 체크리스트
- [ ] Settings - Stealth PNG 설명 Tooltip 전환
- [ ] Settings - Tagger 설명 Tooltip 전환
- [ ] CivitaiUploadModal 설명 Tooltip 전환
- [ ] 페이지 헤더 description 축약

### Phase 2 체크리스트
- [ ] Divider my:3 통일
- [ ] 타이틀-입력박스 간격 수정
- [ ] Dialog 내부 gap:2 표준화
- [ ] 반응형 여백 개선

### Phase 3 체크리스트
- [ ] Tooltip 스타일 통일
- [ ] Alert 사용 통일
- [ ] Button 스타일 통일
- [ ] Card/Paper 여백 통일

### Phase 4 체크리스트
- [ ] InfoTooltip 컴포넌트 생성
- [ ] PageHeader 컴포넌트 생성
- [ ] SectionHeader 컴포넌트 생성
- [ ] FormField 컴포넌트 생성
