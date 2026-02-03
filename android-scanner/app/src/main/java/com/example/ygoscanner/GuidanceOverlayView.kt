package com.example.ygoscanner

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import android.animation.ValueAnimator
import android.view.animation.LinearInterpolator

class GuidanceOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    private val framePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x80FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 6f
    }

    private val cornerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xCC00FFC8.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 8f
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textSize = 32f
    }

    private var pulseAlpha = 1f

    init {
        val animator = ValueAnimator.ofFloat(0.3f, 1f).apply {
            duration = 1200
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener {
                pulseAlpha = it.animatedValue as Float
                invalidate()
            }
        }
        animator.start()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val margin = width * 0.08f
        val frameHeight = height * 0.72f
        val frameTop = (height - frameHeight) / 2f
        val frame = RectF(margin, frameTop, width - margin, frameTop + frameHeight)
        canvas.drawRect(frame, framePaint)

        val cornerSize = 40f
        canvas.drawLine(frame.left, frame.top, frame.left + cornerSize, frame.top, cornerPaint)
        canvas.drawLine(frame.left, frame.top, frame.left, frame.top + cornerSize, cornerPaint)
        canvas.drawLine(frame.right - cornerSize, frame.top, frame.right, frame.top, cornerPaint)
        canvas.drawLine(frame.right, frame.top, frame.right, frame.top + cornerSize, cornerPaint)
        canvas.drawLine(frame.left, frame.bottom, frame.left + cornerSize, frame.bottom, cornerPaint)
        canvas.drawLine(frame.left, frame.bottom - cornerSize, frame.left, frame.bottom, cornerPaint)
        canvas.drawLine(frame.right - cornerSize, frame.bottom, frame.right, frame.bottom, cornerPaint)
        canvas.drawLine(frame.right, frame.bottom - cornerSize, frame.right, frame.bottom, cornerPaint)

        val hint = "Align card inside the frame.\nName (top) + passcode (bottom-left) must be visible."
        val lines = hint.split("\n")
        var y = frame.top - 24f
        lines.forEach { line ->
            canvas.drawText(line, frame.left, y, textPaint)
            y -= 36f
        }

        val passcodeBox = RectF(
            frame.left + frame.width() * 0.08f,
            frame.bottom - frame.height() * 0.28f,
            frame.left + frame.width() * 0.45f,
            frame.bottom - frame.height() * 0.06f
        )
        cornerPaint.alpha = (pulseAlpha * 255).toInt().coerceIn(80, 255)
        canvas.drawRect(passcodeBox, cornerPaint)

        val nameBox = RectF(
            frame.left + frame.width() * 0.08f,
            frame.top + frame.height() * 0.04f,
            frame.right - frame.width() * 0.08f,
            frame.top + frame.height() * 0.16f
        )
        canvas.drawRect(nameBox, framePaint)
    }
}
