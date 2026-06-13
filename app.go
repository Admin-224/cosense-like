package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"strconv"
	"sync"

	_ "modernc.org/sqlite"
)

type TimeStamp struct {
    Label string `json:"label"`
    Time  int    `json:"time"`
}

type PageHeader struct {
	ID           string   `json:"id"` // rowid
	SortID       int64    `json:"sortId"`
	Title        string   `json:"title"`
	URL          string   `json:"url"`
	CategoryID   int      `json:"categoryId"`
	StatusID     int      `json:"statusId"`
	Tags         []string `json:"tags"`
	ThumbnailURL string   `json:"thumbnailUrl"`
	TimeStamps []TimeStamp `json:"timeStamps"`
}

type ProjectContainer struct {
	Pages []PageHeader `json:"pages"`
}

type App struct {
	ctx            context.Context
	mu             sync.RWMutex
	currentProject string
}

type ProjectConfig struct {
	CategoryID int
	JSONFile   string
	TableName  string
	IsTmp      bool
}

type AppConfig struct {
	SecretProjectPassword string              `json:"secretProjectPassword"`
	FixedTags             map[string][]string `json:"fixedTags"`
}

type TagMaster struct {
	Name       string `json:"name"`
	Yomi       string `json:"yomi"`
	CategoryID int    `json:"categoryId"`
	Group      string `json:"group"`
}

var projectMap = map[string]ProjectConfig{
	"mx-music": {
		CategoryID: 1,
		JSONFile:   "mx-music.json",
		TableName:  "t_videos",
	},
	"mx-streaming": {
		CategoryID: 2,
		JSONFile:   "mx-streaming.json",
		TableName:  "t_videos",
	},
	"mx-anomaly": {
		CategoryID: 3,
		JSONFile:   "mx-anomaly.json",
		TableName:  "t_videos",
	},
	"mx-other": {
		CategoryID: 4,
		JSONFile:   "mx-other.json",
		TableName:  "t_videos",
	},
	"mx-tmp": {
		JSONFile:  "mx-tmp.json",
		TableName: "t_tmp_videos",
		IsTmp:     true,
	},
	"mx-secret": {
		JSONFile:  "mx-secret.json",
		TableName: "t_secret",
		IsTmp:     true,
	},
}

func (a *App) GetFixedTags() ([]string, error) {

	config, err := a.loadConfig()
	if err != nil {
		return nil, err
	}

	tags :=
		config.FixedTags[a.currentProject]

	if tags == nil {
		return []string{}, nil
	}

	return tags, nil
}

func (a *App) saveProjectJSON(pages []PageHeader) error {
	jsonPath := a.getJsonFilePath()

	container := ProjectContainer{
		Pages: pages,
	}

	bytes, err := json.MarshalIndent(container, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(jsonPath, bytes, 0644)
}

func NewApp() *App {
	return &App{
		currentProject: "mx-music",
	}
}

func (a *App) loadConfig() (*AppConfig, error) {

	path := filepath.Join(
		"backend",
		"data",
		"config.json",
	)

	// フォルダ作成
	err := os.MkdirAll(
		filepath.Dir(path),
		0755,
	)
	if err != nil {
		return nil, err
	}

	// 存在しないなら生成
	if _, err := os.Stat(path); os.IsNotExist(err) {

		defaultConfig := AppConfig{
			SecretProjectPassword: "",
			FixedTags: map[string][]string{
				"mx-music": {
					"Real",
					"Virtual",
					"Vocaloid",
					"Original",
					"Cover",
					"Other",
					"Live",
				},
				"mx-streaming": {},
				"mx-anomaly":   {},
				"mx-other":     {},
				"mx-tmp":       {},
				"mx-secret":    {},
			},
		}

		bytes, err :=
			json.MarshalIndent(
				defaultConfig,
				"",
				"  ",
			)
		if err != nil {
			return nil, err
		}

		err = os.WriteFile(
			path,
			bytes,
			0644,
		)
		if err != nil {
			return nil, err
		}
	}

	// 読み込み
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var config AppConfig

	err = json.Unmarshal(
		bytes,
		&config,
	)
	if err != nil {
		return nil, err
	}

	// nil保険
	if config.FixedTags == nil {
		config.FixedTags =
			map[string][]string{}
	}

	return &config, nil
}

func (a *App) getJsonFilePath() string {
	dir := filepath.Join("backend", "data")
	os.MkdirAll(dir, 0755)

	config, ok := projectMap[a.currentProject]
	if !ok {
		config = projectMap["mx-music"]
	}

	return filepath.Join(dir, config.JSONFile)
}

func (a *App) SwitchProject(projectName string, password string) (bool, error) {

	a.mu.Lock()
	defer a.mu.Unlock()

	// secretだけパスワード要求
	if projectName == "mx-secret" {

		config, err := a.loadConfig()
		if err != nil {
			return false, err
		}

		if password != config.SecretProjectPassword {
			return false, fmt.Errorf("password incorrect")
		}
	}

	a.currentProject = projectName

	log.Printf("プロジェクトを %s に切り替えました", projectName)

	return true, nil
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	a.StartVideoProxy()
}

func (a *App) GetTags() ([]TagMaster, error) {

	a.mu.RLock()
	defer a.mu.RUnlock()

	db, err := sql.Open(
		"sqlite",
		`C:\sqlite\Cosense.db`,
	)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	config := projectMap[a.currentProject]

	rows, err := db.Query(`
		SELECT
			name,
			yomi,
			category_id
		FROM m_tags
		WHERE category_id = ?
		ORDER BY yomi ASC
	`, config.CategoryID)

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []TagMaster{}

	for rows.Next() {

		var t TagMaster

		err := rows.Scan(
			&t.Name,
			&t.Yomi,
			&t.CategoryID,
		)
		if err != nil {
			return nil, err
		}

		t.Group =
			getKanaGroup(t.Yomi)

		result =
			append(result, t)
	}

	return result, nil
}

func getKanaGroup(yomi string) string {

	if yomi == "" {
		return "他"
	}

	r := []rune(strings.ToLower(yomi))[0]

	switch {
	case strings.ContainsRune("アイウエオァィゥェォヴ", r):
		return "あ"

	case strings.ContainsRune("カキクケコガギグゲゴ", r):
		return "か"

	case strings.ContainsRune("サシスセソザジズゼゾ", r):
		return "さ"

	case strings.ContainsRune("タチツテトダヂヅデド", r):
		return "た"

	case strings.ContainsRune("ナニヌネノ", r):
		return "な"

	case strings.ContainsRune("ハヒフヘホバビブベボパピプペポ", r):
		return "は"

	case strings.ContainsRune("マミムメモ", r):
		return "ま"

	case strings.ContainsRune("ヤユヨ", r):
		return "や"

	case strings.ContainsRune("ラリルレロ", r):
		return "ら"

	default:
		return "わ"
	}
}

func (a *App) GetAllPageList() ([]PageHeader, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	dbPath := `C:\sqlite\Cosense.db`
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	config, ok := projectMap[a.currentProject]
	if !ok {
		config = projectMap["mx-music"]
	}

	var query string

	if config.IsTmp {
		query = fmt.Sprintf(`
			SELECT rowid, id, title, url, status_id
			FROM %s
			ORDER BY rowid DESC
		`, config.TableName)
	} else {
		query = fmt.Sprintf(`
			SELECT
				rowid,
				id,
				title,
				url,
				status_id,
				tag1, tag2, tag3, tag4, tag5,
				tag6, tag7, tag8, tag9, tag10,
				tag11, tag12, tag13, tag14, tag15,
				tag16, tag17, tag18, tag19, tag20,
				tag21, tag22, tag23, tag24, tag25,
				tag26, tag27, tag28, tag29, tag30,
				tag31, tag32, tag33, tag34, tag35,
				tag36, tag37, tag38, tag39, tag40,
				tag41, tag42, tag43, tag44, tag45,
				tag46, tag47, tag48, tag49, tag50,
				tag51, tag52, tag53, tag54, tag55,
				tag56, tag57, tag58, tag59, tag60,
				tag61, tag62, tag63, tag64, tag65,
				tag66, tag67, tag68, tag69, tag70,
				tag71, tag72, tag73, tag74, tag75,
				tag76, tag77, tag78, tag79, tag80,
				tag81, tag82, tag83, tag84, tag85,
				tag86, tag87, tag88, tag89, tag90,
				tag91, tag92, tag93, tag94, tag95,
				tag96, tag97, tag98, tag99, tag100
			FROM %s
			WHERE category_id = %d
			ORDER BY rowid DESC
		`, config.TableName, config.CategoryID)
	}

	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dbPages []PageHeader
	for rows.Next() {

		var rowid int64
		var sortID int64
		var title, url string
		var statusId int

		var tags []string

		if config.IsTmp {

			if err := rows.Scan(
				&rowid,
				&sortID,
				&title,
				&url,
				&statusId,
			); err != nil {
				return nil, err
			}

		} else {

			var tagCols [100]sql.NullString

			scanArgs := []any{
				&rowid,
				&sortID,
				&title,
				&url,
				&statusId,
			}

			for i := range tagCols {
				scanArgs = append(scanArgs, &tagCols[i])
			}

			if err := rows.Scan(scanArgs...); err != nil {
				return nil, err
			}

			for _, t := range tagCols {
				if t.Valid {
					s := strings.TrimSpace(t.String)
					if s != "" && s != "NULL" && s != "« NULL »" {
						tags = append(tags, s)
					}
				}
			}
		}

		dbPages = append(dbPages, PageHeader{
			ID:     strconv.FormatInt(rowid, 10),
			SortID: sortID,
			Title:        title,
			URL:          url,
			CategoryID:   config.CategoryID,
			StatusID:     statusId,
			Tags:         tags,
			ThumbnailURL: extractThumbnail(url),
		})
	}

	jsonPath := a.getJsonFilePath()
	var jsonPages []PageHeader
	if _, err := os.Stat(jsonPath); err == nil {
		jsonBytes, err := os.ReadFile(jsonPath)
		if err == nil {
			var container ProjectContainer
			if err := json.Unmarshal(jsonBytes, &container); err == nil {
				jsonPages = container.Pages
			}
		}
	}

	jsonMap := make(map[string]PageHeader)
	for _, p := range jsonPages {
		jsonMap[p.ID] = p
	}

	var mergedPages []PageHeader

	for _, dp := range dbPages {

		if jp, exists := jsonMap[dp.ID]; exists {

			// DBの最新値を優先
			jp.ID = dp.ID
			jp.SortID = dp.SortID
			jp.Title = dp.Title
			jp.URL = dp.URL
			jp.StatusID = dp.StatusID
			jp.CategoryID = dp.CategoryID
			jp.ThumbnailURL = dp.ThumbnailURL

			// ←超重要
			jp.Tags = dp.Tags

			mergedPages = append(mergedPages, jp)

		} else {

			mergedPages = append(mergedPages, dp)
		}
	}

	sort.Slice(mergedPages, func(i, j int) bool {
		return mergedPages[i].SortID > mergedPages[j].SortID
	})

	// =====================
	// jsonへ同期保存
	// =====================
	if err := a.saveProjectJSON(mergedPages); err != nil {
		log.Println("json save error:", err)
	}

	return mergedPages, nil
}

func (a *App) UpdatePageStatus(rowIDStr string, newStatusID int) (bool, error) {
	rowID, err := strconv.ParseInt(rowIDStr, 10, 64)
	if err != nil {
		return false, err
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	dbPath := `C:\sqlite\Cosense.db`
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return false, err
	}
	defer db.Close()

	config, ok := projectMap[a.currentProject]
	if !ok {
		config = projectMap["mx-music"]
	}

	var query string

	if config.IsTmp {
		query = fmt.Sprintf(`
			UPDATE %s
			SET status_id = ?
			WHERE rowid = ?
		`, config.TableName)
	} else {
		query = fmt.Sprintf(`
			UPDATE %s
			SET status_id = ?
			WHERE rowid = ?
			AND category_id = %d
		`, config.TableName, config.CategoryID)
	}

	_, err = db.Exec(query, newStatusID, rowID)
	if err != nil {
		return false, err
	}

	jsonPath := a.getJsonFilePath()
	jsonBytes, err := os.ReadFile(jsonPath)
	if err == nil {
		var container ProjectContainer
		if err := json.Unmarshal(jsonBytes, &container); err == nil {
			for i, p := range container.Pages {
				if p.ID == rowIDStr {
					container.Pages[i].StatusID = newStatusID
					break
				}
			}
			newBytes, _ := json.MarshalIndent(container, "", "  ")
			_ = os.WriteFile(jsonPath, newBytes, 0644)
		}
	}

	log.Printf("[%s] ID: %s のステータスを %d に更新しました", a.currentProject, rowIDStr, newStatusID)
	return true, nil
}

func (a *App) SaveTimeStamps(
	pageID string,
	timeStamps []TimeStamp,
) (bool, error) {

	a.mu.Lock()
	defer a.mu.Unlock()

	jsonPath := a.getJsonFilePath()

	jsonBytes, err := os.ReadFile(jsonPath)
	if err != nil {
		return false, err
	}

	var container ProjectContainer

	err = json.Unmarshal(
		jsonBytes,
		&container,
	)
	if err != nil {
		return false, err
	}

	found := false

	for i := range container.Pages {

		if container.Pages[i].ID == pageID {

			container.Pages[i].TimeStamps =
				timeStamps

			found = true
			break
		}
	}

	if !found {
		return false, fmt.Errorf(
			"page not found: %s",
			pageID,
		)
	}

	newBytes, err :=
		json.MarshalIndent(
			container,
			"",
			"  ",
		)

	if err != nil {
		return false, err
	}

	err = os.WriteFile(
		jsonPath,
		newBytes,
		0644,
	)

	if err != nil {
		return false, err
	}

	return true, nil
}

func extractThumbnail(url string) string {
	reYT := regexp.MustCompile(`(?i)(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)`)
	if match := reYT.FindStringSubmatch(url); len(match) > 1 {
		return fmt.Sprintf("https://img.youtube.com/vi/%s/0.jpg", match[1])
	}
	reNico := regexp.MustCompile(`(?i)nicovideo\.jp/watch/(sm[0-9]+|[0-9]+)`)
	if reNico.MatchString(url) {
		return "https://www.nicovideo.jp/favicon.ico"
	}
	reX := regexp.MustCompile(`(?i)(twitter\.com|x\.com)/`)
	if reX.MatchString(url) {
		return "https://abs.twimg.com/favicons/twitter.2.ico"
	}
	reInsta := regexp.MustCompile(`(?i)instagram\.com/`)
	if reInsta.MatchString(url) {
		return "https://www.instagram.com/static/images/ico/favicon.ico/36b30c2c9254.ico"
	}
	return ""
}

// ローカル動画プロキシ
func (a *App) StartVideoProxy() {

	mux := http.NewServeMux()

	mux.HandleFunc("/video", func(w http.ResponseWriter, r *http.Request) {

		targetURL := r.URL.Query().Get("url")
		if targetURL == "" {
			http.Error(w, "missing url", http.StatusBadRequest)
			return
		}

		req, err := http.NewRequest("GET", targetURL, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Twitter/X CDN向け
		req.Header.Set(
			"User-Agent",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
		)

		req.Header.Set("Referer", "https://x.com/")
		req.Header.Set("Accept", "*/*")

		// videoタグのRange転送（超重要）
		if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
			log.Println("range:", rangeHeader)
		}

		client := &http.Client{}

		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		log.Println("status:", resp.StatusCode)
		log.Println("content-type:", resp.Header.Get("Content-Type"))
		log.Println("content-length:", resp.Header.Get("Content-Length"))
		log.Println("content-range:", resp.Header.Get("Content-Range"))

		// ==========================
		// ヘッダを先に設定する（重要）
		// ==========================

		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}

		if cl := resp.Header.Get("Content-Length"); cl != "" {
			w.Header().Set("Content-Length", cl)
		}

		if cr := resp.Header.Get("Content-Range"); cr != "" {
			w.Header().Set("Content-Range", cr)
		}

		if ar := resp.Header.Get("Accept-Ranges"); ar != "" {
			w.Header().Set("Accept-Ranges", ar)
		} else {
			w.Header().Set("Accept-Ranges", "bytes")
		}

		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		// ← ヘッダ設定後に status
		w.WriteHeader(resp.StatusCode)

		// ストリーム転送
		n, err := io.Copy(w, resp.Body)
		if err != nil {
			log.Println("proxy stream error:", err)
			return
		}

		log.Println("download size:", n)
	})

	go func() {
		log.Println("video proxy started :54321")

		err := http.ListenAndServe(":54321", mux)
		if err != nil {
			log.Println(err)
		}
	}()
}
