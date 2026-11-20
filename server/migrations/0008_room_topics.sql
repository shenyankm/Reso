CREATE TABLE topic_cards (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO topic_cards(question) VALUES
  ('最近哪件小事让你开心了一下？'),
  ('如果明天有一整天空闲，你想怎么过？'),
  ('最近有没有一首想推荐给对方的歌？'),
  ('小时候喜欢、现在还喜欢的东西是什么？'),
  ('最近你做了哪件以前觉得自己做不到的事？'),
  ('你会给今天留下一张什么样的照片？'),
  ('如果可以互相教一个小本领，你想教什么？'),
  ('最近有没有一道想和对方一起吃的菜？'),
  ('在家里，你最喜欢待在哪个角落？'),
  ('有没有一句别人说过的话，让你觉得被理解？'),
  ('你想和对方一起去散步的地方是哪里？'),
  ('有哪件小事，你想下次一起试试？');

CREATE TABLE room_topic_rounds (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  card_id smallint NOT NULL REFERENCES topic_cards(id),
  question text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX room_topic_rounds_recent ON room_topic_rounds(event_id,created_at DESC,id DESC);

CREATE TABLE room_topic_answers (
  round_id uuid NOT NULL REFERENCES room_topic_rounds(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 400),
  PRIMARY KEY(round_id,user_id)
);
