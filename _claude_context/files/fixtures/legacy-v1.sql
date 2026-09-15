-- Historical schema for upgrade verification. Keep unchanged.
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
        CREATE TABLE problems (id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT, statement_path TEXT NOT NULL,
          source_zip_name TEXT, cpp_time_limit_ms INTEGER NOT NULL, python_time_limit_ms INTEGER NOT NULL,
          output_comparison TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT);
        CREATE TABLE test_groups (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
          name TEXT NOT NULL, sort_order INTEGER NOT NULL);
        CREATE TABLE test_cases (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES test_groups(id) ON DELETE CASCADE,
          name TEXT NOT NULL, input_path TEXT NOT NULL, output_path TEXT NOT NULL, sort_order INTEGER NOT NULL);
        CREATE TABLE approaches (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
          name TEXT NOT NULL, sort_order INTEGER NOT NULL, cpp_code TEXT NOT NULL, python_code TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE run_history (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
          approach_id TEXT NOT NULL REFERENCES approaches(id) ON DELETE CASCADE, language TEXT NOT NULL,
          overall_verdict TEXT NOT NULL, passed_count INTEGER NOT NULL, total_count INTEGER NOT NULL,
          total_wall_time_ms REAL, created_at TEXT NOT NULL);
        CREATE INDEX groups_problem ON test_groups(problem_id);
        CREATE INDEX cases_group ON test_cases(group_id);
        CREATE INDEX approaches_problem ON approaches(problem_id);
        CREATE INDEX history_problem ON run_history(problem_id);
        CREATE INDEX history_approach ON run_history(approach_id);
        CREATE INDEX problems_opened ON problems(last_opened_at);
        PRAGMA user_version = 1;
