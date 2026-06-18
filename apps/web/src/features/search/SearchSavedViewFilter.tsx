interface SearchSavedViewCategory {
  id: string;
  label: string;
  count: number;
}

interface SearchSavedViewFilterProps {
  categories: SearchSavedViewCategory[];
  selectedSavedView?: string;
  onSelectSavedView: (savedView: string | undefined) => void;
}

export function SearchSavedViewFilter(props: SearchSavedViewFilterProps) {
  if (props.categories.length === 0) {
    return null;
  }

  return (
    <div className="filter-row" aria-label="常用分类搜索筛选">
      {props.categories.slice(0, 12).map((category) => (
        <button
          key={category.id}
          className={props.selectedSavedView === category.id ? "active" : ""}
          type="button"
          aria-label={`Search saved view ${category.label}`}
          onClick={() =>
            props.onSelectSavedView(
              props.selectedSavedView === category.id ? undefined : category.id,
            )
          }
        >
          {category.label}
          {category.count > 0 ? ` ${category.count}` : ""}
        </button>
      ))}
    </div>
  );
}
