'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getErrorMessage } from '@/lib/errorMessage'

type CommentReaction = 'up' | 'down'

type BlogComment = {
  id: string
  post_slug: string
  profile_id: string
  parent_comment_id: string | null
  author_name: string | null
  avatar_url: string | null
  body: string
  created_at: string
  updated_at: string
  up_count: number
  down_count: number
  viewer_reaction: CommentReaction | null
}

type BlogShareAndCommentsProps = {
  postSlug: string
  title: string
  description: string
  shareUrl: string
  commentsFirst?: boolean
}

function initials(name: string | null) {
  if (!name) return 'SS'
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  return words[0]?.slice(0, 2).toUpperCase() || 'SS'
}

function commentDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function BlogShareAndComments({ postSlug, title, description, shareUrl, commentsFirst = false }: BlogShareAndCommentsProps) {
  const [userId, setUserId] = useState<string | null>(null)
  const [comments, setComments] = useState<BlogComment[]>([])
  const [body, setBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submittingReply, setSubmittingReply] = useState(false)
  const [reactingId, setReactingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repliesByParent = useMemo(() => {
    const map = new Map<string, BlogComment[]>()
    for (const comment of comments) {
      if (!comment.parent_comment_id) continue
      const list = map.get(comment.parent_comment_id) || []
      list.push(comment)
      map.set(comment.parent_comment_id, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return map
  }, [comments])
  const topLevelComments = useMemo(() => comments.filter((comment) => !comment.parent_comment_id), [comments])
  const visibleComments = expanded ? topLevelComments : topLevelComments.slice(0, 5)
  const remainingCount = Math.max(0, topLevelComments.length - visibleComments.length)
  const encodedUrl = encodeURIComponent(shareUrl)
  const encodedTitle = encodeURIComponent(title)
  const encodedText = encodeURIComponent(`${title} - ${description}`)
  const textHref = `sms:?&body=${encodedText}%20${encodedUrl}`
  const emailHref = `mailto:?subject=${encodedTitle}&body=${encodedText}%0A%0A${encodedUrl}`
  const xHref = `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`

  const socialPostText = useMemo(() => `${title}\n\n${description}\n\n${shareUrl}`, [description, shareUrl, title])

  const loadComments = useCallback(async () => {
    setError(null)
    const { data, error: commentErr } = await supabase.rpc('blog_comments_for_post', { p_post_slug: postSlug })
    if (commentErr) throw commentErr
    setComments((data || []) as BlogComment[])
  }, [postSlug])

  useEffect(() => {
    let alive = true

    const init = async () => {
      try {
        setLoading(true)
        const [{ data: userData }, commentResult] = await Promise.all([
          supabase.auth.getUser(),
          supabase.rpc('blog_comments_for_post', { p_post_slug: postSlug }),
        ])
        if (!alive) return
        if (commentResult.error) throw commentResult.error
        setUserId(userData.user?.id ?? null)
        setComments((commentResult.data || []) as BlogComment[])
      } catch (e: unknown) {
        if (alive) setError(getErrorMessage(e, 'Failed to load comments.'))
      } finally {
        if (alive) setLoading(false)
      }
    }

    init()
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
      loadComments().catch((e) => setError(getErrorMessage(e, 'Failed to refresh comments.')))
    })

    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [loadComments, postSlug])

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy the link.')
    }
  }

  const nativeShare = async () => {
    if (!navigator.share) {
      await copyShareLink()
      return
    }
    try {
      await navigator.share({ title, text: description, url: shareUrl })
    } catch {}
  }

  const copySocialPost = async () => {
    try {
      await navigator.clipboard.writeText(socialPostText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy the social post.')
    }
  }

  const submitComment = async (parentCommentId: string | null = null) => {
    const cleanBody = (parentCommentId ? replyBody : body).trim()
    if (!userId || !cleanBody || submitting || submittingReply) return
    if (parentCommentId) setSubmittingReply(true)
    else setSubmitting(true)
    setError(null)
    try {
      const { error: insertErr } = await supabase.from('blog_comments').insert({
        post_slug: postSlug,
        profile_id: userId,
        parent_comment_id: parentCommentId,
        body: cleanBody,
      })
      if (insertErr) throw insertErr
      if (parentCommentId) {
        setReplyBody('')
        setReplyingTo(null)
      } else {
        setBody('')
      }
      setExpanded(true)
      await loadComments()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to post comment.'))
    } finally {
      if (parentCommentId) setSubmittingReply(false)
      else setSubmitting(false)
    }
  }

  const reactToComment = async (comment: BlogComment, reaction: CommentReaction) => {
    if (!userId || reactingId) return
    setReactingId(comment.id)
    setError(null)
    try {
      if (comment.viewer_reaction === reaction) {
        const { error: deleteErr } = await supabase
          .from('blog_comment_reactions')
          .delete()
          .eq('comment_id', comment.id)
          .eq('profile_id', userId)
        if (deleteErr) throw deleteErr
      } else {
        const { error: upsertErr } = await supabase
          .from('blog_comment_reactions')
          .upsert({ comment_id: comment.id, profile_id: userId, reaction }, { onConflict: 'comment_id,profile_id' })
        if (upsertErr) throw upsertErr
      }
      await loadComments()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save reaction.'))
    } finally {
      setReactingId(null)
    }
  }

  const shareSection = (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Share this article</h2>
            <p className="mt-1 text-sm text-slate-600">Send it to your league, group text, or social feed.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={nativeShare} className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Share
            </button>
            <button type="button" onClick={copyShareLink} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-white">
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a href={textHref} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-white">
              Text
            </a>
            <a href={emailHref} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-white">
              Email
            </a>
            <a href={xHref} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-white">
              X
            </a>
            <a href={facebookHref} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-white">
              Facebook
            </a>
            <button type="button" onClick={copySocialPost} className="rounded-md border border-[#d2ad5b]/60 bg-[#fffaf0] px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white">
              Copy post
            </button>
          </div>
        </div>
      </section>
  )

  const commentsSection = (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold tracking-normal text-slate-950">Comments</h2>
            <p className="mt-1 text-sm text-slate-600">Signed-in readers can join the thread.</p>
          </div>
          {comments.length > 0 && <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{comments.length} comments</div>}
        </div>

        {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="mt-5">
          {userId ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={2000}
                placeholder="Add your comment..."
                className="min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 focus:border-[#c5161d] focus:outline-none focus:ring-2 focus:ring-red-100"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{body.trim().length}/2000</span>
                <button
                  type="button"
                  onClick={() => submitComment()}
                  disabled={submitting || !body.trim()}
                  className="rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a91218] disabled:opacity-50"
                >
                  {submitting ? 'Posting...' : 'Post comment'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-[#d2ad5b]/50 bg-[#fffaf0] p-4 text-sm text-slate-700">
              <a href={`/?auth=signin&returnTo=${encodeURIComponent(`/blog/${postSlug}`)}`} className="font-bold text-[#c5161d] hover:text-[#a91218]">
                Sign in
              </a>{' '}
              to comment or react.
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3">
          {loading ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading comments...</p>
          ) : comments.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No comments yet. Be the first one in.</p>
          ) : (
            visibleComments.map((comment) => (
              <article key={comment.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-xs font-bold text-white">
                    {comment.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={comment.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      initials(comment.author_name)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-950">{comment.author_name || 'Player'}</span>
                      <span className="text-xs text-slate-500">{commentDate(comment.created_at)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{comment.body}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => reactToComment(comment, 'up')}
                        disabled={!userId || reactingId === comment.id}
                        aria-label="Thumbs up"
                        className={`rounded-full border px-3 py-1 text-sm font-semibold transition disabled:opacity-50 ${
                          comment.viewer_reaction === 'up' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                        }`}
                      >
                        👍 {comment.up_count}
                      </button>
                      <button
                        type="button"
                        onClick={() => reactToComment(comment, 'down')}
                        disabled={!userId || reactingId === comment.id}
                        aria-label="Thumbs down"
                        className={`rounded-full border px-3 py-1 text-sm font-semibold transition disabled:opacity-50 ${
                          comment.viewer_reaction === 'down' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                        }`}
                      >
                        👎 {comment.down_count}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingTo((current) => (current === comment.id ? null : comment.id))
                          setReplyBody('')
                        }}
                        disabled={!userId}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
                      >
                        Reply
                      </button>
                    </div>
                    {replyingTo === comment.id && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <textarea
                          value={replyBody}
                          onChange={(event) => setReplyBody(event.target.value)}
                          maxLength={2000}
                          placeholder={`Reply to ${comment.author_name || 'this comment'}...`}
                          className="min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 focus:border-[#c5161d] focus:outline-none focus:ring-2 focus:ring-red-100"
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-slate-500">{replyBody.trim().length}/2000</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingTo(null)
                                setReplyBody('')
                              }}
                              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => submitComment(comment.id)}
                              disabled={submittingReply || !replyBody.trim()}
                              className="rounded-md bg-[#c5161d] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#a91218] disabled:opacity-50"
                            >
                              {submittingReply ? 'Replying...' : 'Post reply'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {(repliesByParent.get(comment.id) || []).length > 0 && (
                      <div className="mt-4 grid gap-3 border-l-2 border-slate-200 pl-3">
                        {(repliesByParent.get(comment.id) || []).map((reply) => (
                          <div key={reply.id} className="rounded-lg bg-slate-50 p-3">
                            <div className="flex gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-[11px] font-bold text-white">
                                {reply.avatar_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={reply.avatar_url} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  initials(reply.author_name)
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-slate-950">{reply.author_name || 'Player'}</span>
                                  <span className="text-xs text-slate-500">{commentDate(reply.created_at)}</span>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{reply.body}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => reactToComment(reply, 'up')}
                                    disabled={!userId || reactingId === reply.id}
                                    aria-label="Thumbs up"
                                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                                      reply.viewer_reaction === 'up' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    👍 {reply.up_count}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => reactToComment(reply, 'down')}
                                    disabled={!userId || reactingId === reply.id}
                                    aria-label="Thumbs down"
                                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                                      reply.viewer_reaction === 'down' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    👎 {reply.down_count}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        {remainingCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-4 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-white"
          >
            Show {remainingCount} more comments
          </button>
        )}
        {expanded && topLevelComments.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-3 w-full rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Show fewer comments
          </button>
        )}
      </section>
  )

  return (
    <div className="mt-8 grid gap-6">
      {commentsFirst ? commentsSection : shareSection}
      {commentsFirst ? shareSection : commentsSection}
    </div>
  )
}
