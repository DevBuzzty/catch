package com.example.ygoscanner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var serverInput: EditText
    private lateinit var startButton: Button
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var webSocket: WebSocket? = null
    private var lastSentKey: String? = null
    private var lastAnalysisAt = 0L
    private var candidatePasscode: String? = null
    private var candidateHits = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        previewView = findViewById(R.id.previewView)
        statusText = findViewById(R.id.statusText)
        serverInput = findViewById(R.id.serverInput)
        startButton = findViewById(R.id.startButton)

        startButton.setOnClickListener {
            if (hasCameraPermission()) {
                connectAndStart()
            } else {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1001)
            }
        }
    }

    private fun connectAndStart() {
        val target = serverInput.text.toString().trim()
        if (target.isEmpty()) {
            statusText.text = "Status: Bitte PC IP:Port eingeben"
            return
        }
        val wsUrl = "ws://$target"
        val client = OkHttpClient()
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                statusText.post { statusText.text = "Status: Verbindung fehlgeschlagen" }
            }
        })
        statusText.text = "Status: verbunden ($wsUrl)"
        startCamera()
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { imageAnalysis ->
                imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                    val now = System.currentTimeMillis()
                    if (now - lastAnalysisAt < 700) {
                        imageProxy.close()
                        return@setAnalyzer
                    }
                    lastAnalysisAt = now
                    val mediaImage = imageProxy.image
                    if (mediaImage != null) {
                        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                        recognizer.process(image)
                            .addOnSuccessListener { visionText ->
                                val passcode = extractPasscode(visionText, imageProxy.width, imageProxy.height)
                                if (passcode != null) {
                                    trackCandidate(passcode)?.let { confirmed ->
                                        sendCard(CardPayload(deName = "", enName = "", passcode = confirmed))
                                        statusText.post { statusText.text = "Status: Passcode erkannt ($confirmed)" }
                                    }
                                } else {
                                    statusText.post { statusText.text = "Status: Suche Passcode…" }
                                }
                            }
                            .addOnCompleteListener {
                                imageProxy.close()
                            }
                    } else {
                        imageProxy.close()
                    }
                }
            }

            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(this))
    }

    private fun extractPasscode(visionText: com.google.mlkit.vision.text.Text, width: Int, height: Int): String? {
        val regionLeft = (width * 0.45f).toInt()
        val regionTop = (height * 0.6f).toInt()
        val regionRight = width
        val regionBottom = height
        val regex = Regex("\\b\\d{8}\\b")

        val candidates = mutableListOf<String>()
        for (block in visionText.textBlocks) {
            val box = block.boundingBox ?: continue
            val inRegion = box.centerX() >= regionLeft && box.centerY() >= regionTop
            val digits = regex.find(block.text)?.value
            if (digits != null && inRegion) {
                candidates.add(digits)
            }
        }
        if (candidates.isNotEmpty()) {
            return candidates.first()
        }

        for (block in visionText.textBlocks) {
            for (line in block.lines) {
                val lineDigits = regex.find(line.text)?.value
                if (lineDigits != null) return lineDigits
                val cleaned = line.text.filter { it.isDigit() }
                if (cleaned.length == 8) return cleaned
            }
        }
        return null
    }

    private fun trackCandidate(passcode: String): String? {
        if (passcode != candidatePasscode) {
            candidatePasscode = passcode
            candidateHits = 1
            return null
        }
        candidateHits += 1
        return if (candidateHits >= 2) {
            candidatePasscode = null
            candidateHits = 0
            passcode
        } else {
            null
        }
    }

    private fun sendCard(card: CardPayload) {
        val key = card.passcode.trim().lowercase()
        if (key.isBlank() || key == lastSentKey) {
            return
        }
        lastSentKey = key
        val obj = JSONObject()
        obj.put("type", "scan")
        obj.put("card", JSONObject().apply {
            put("de_name", card.deName)
            put("en_name", card.enName)
            put("passcode", card.passcode)
        })
        webSocket?.send(obj.toString())
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
}

data class CardPayload(val deName: String, val enName: String, val passcode: String)
